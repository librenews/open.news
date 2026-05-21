/**
 * Backfill embeddings for existing verified site_standard_articles.
 *
 * Only processes verified documents (verified = true).
 *
 * Usage:
 *   node --env-file=.env --import tsx/esm src/scripts/backfillEmbeddings.ts [options]
 *
 * Options:
 *   --days=N          Only embed articles from the last N days (default: all)
 *   --limit=N         Max articles to process (default: 10000)
 *   --batch=N         Articles per batch (default: 20)
 *   --min-words=N     Minimum word count (default: 50)
 */

import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { chunkText } from '../lib/chunking.js';
import { embedTexts, checkEmbedHealth } from '../track/embedClient.js';
import { getOsClient, SITE_STANDARD_CHUNKS_INDEX, ensureSiteStandardChunksIndex } from '../track/opensearch.js';
import { extractTextFromSiteStandard } from '../jobs/indexSiteStandard.js';

// ── Parse CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const daysArg = args.find(a => a.startsWith('--days='));
const days = daysArg ? parseInt(daysArg.split('=')[1]) : null;
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 10000;
const batchArg = args.find(a => a.startsWith('--batch='));
const batchSize = batchArg ? parseInt(batchArg.split('=')[1]) : 20;
const minWordsArg = args.find(a => a.startsWith('--min-words='));
const minWords = minWordsArg ? parseInt(minWordsArg.split('=')[1]) : 50;

const DELAY_MS = 100;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Backfill Embeddings (verified docs only) ===\n');
  console.log(`  Options: days=${days ?? 'all'}, limit=${limit}, batch=${batchSize}, min-words=${minWords}\n`);

  // 1. Check embed service health
  const healthy = await checkEmbedHealth();
  if (!healthy) {
    console.error('❌ Embed service is not reachable. Start it first.');
    process.exit(1);
  }
  console.log('✅ Embed service is healthy\n');

  // 2. Ensure OpenSearch index exists
  await ensureSiteStandardChunksIndex();
  console.log('✅ OpenSearch site_standard_chunks index ready\n');

  // 3. Query verified articles
  const conditions = ['verified = true', 'word_count >= $1'];
  const params: any[] = [minWords];

  if (days) {
    params.push(days);
    conditions.push(`created_at >= NOW() - INTERVAL '${days} days'`);
  }

  params.push(limit);
  const query = `
    SELECT uri, author_did, site, path, language,
           published_at, word_count, raw_record
    FROM site_standard_articles
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${params.length}
  `;

  console.log('🔍 Querying verified articles...');
  const { rows } = await db.query(query, params);
  console.log(`  Found ${rows.length} verified articles to embed\n`);

  if (rows.length === 0) {
    console.log('Nothing to do.');
    process.exit(0);
  }

  // 4. Process in batches
  let totalChunks = 0;
  let articlesProcessed = 0;
  let articlesSkipped = 0;
  let errors = 0;
  const os = getOsClient();

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    // Extract text and chunk each article
    const articleChunks: { article: any; chunks: string[] }[] = [];

    for (const article of batch) {
      try {
        const text = extractTextFromSiteStandard(article.raw_record || {});
        if (!text || text.trim().length < 20) {
          articlesSkipped++;
          continue;
        }
        const chunks = chunkText(text);
        if (chunks.length === 0) {
          articlesSkipped++;
          continue;
        }
        articleChunks.push({ article, chunks });
      } catch {
        articlesSkipped++;
      }
    }

    if (articleChunks.length === 0) continue;

    // Flatten all chunks for batch embedding
    const allChunks: string[] = [];
    const chunkMap: { articleIdx: number; chunkIdx: number }[] = [];

    for (let a = 0; a < articleChunks.length; a++) {
      for (let c = 0; c < articleChunks[a].chunks.length; c++) {
        allChunks.push(articleChunks[a].chunks[c]);
        chunkMap.push({ articleIdx: a, chunkIdx: c });
      }
    }

    try {
      // Embed in sub-batches of 64
      const MAX_EMBED_BATCH = 64;
      const allEmbeddings: number[][] = [];

      for (let e = 0; e < allChunks.length; e += MAX_EMBED_BATCH) {
        const slice = allChunks.slice(e, e + MAX_EMBED_BATCH);
        const { embeddings } = await embedTexts(slice);
        allEmbeddings.push(...embeddings);
      }

      // Build OpenSearch bulk body
      const bulkBody: any[] = [];
      for (let j = 0; j < chunkMap.length; j++) {
        const { articleIdx, chunkIdx } = chunkMap[j];
        const article = articleChunks[articleIdx].article;

        bulkBody.push({ index: { _index: SITE_STANDARD_CHUNKS_INDEX, _id: `${article.uri}_chunk_${chunkIdx}` } });
        bulkBody.push({
          uri: article.uri,
          did: article.author_did,
          chunk_index: chunkIdx,
          published_at: article.published_at ? new Date(article.published_at).toISOString() : null,
          text_content: allChunks[j],
          site: article.site,
          language: article.language,
          embedding: allEmbeddings[j],
        });
      }

      if (bulkBody.length > 0) {
        const res = await os.bulk({ body: bulkBody });
        if (res.body.errors) {
          errors++;
          // Log first failing item for diagnosis
          const failedItems = (res.body.items || []).filter((item: any) => item.index?.error);
          if (failedItems.length > 0) {
            const first = failedItems[0].index;
            console.error(`  ⚠️  Bulk error (${failedItems.length}/${res.body.items.length} items): ${first.error?.type}: ${first.error?.reason} [id: ${first._id}]`);
          }
        }
      }

      articlesProcessed += articleChunks.length;
      totalChunks += allChunks.length;

    } catch (err) {
      errors++;
      console.error(`  ❌ Batch ${i}-${i + batchSize} failed:`, (err as Error).message);
    }

    // Progress every 100 articles
    if ((i + batchSize) % 100 === 0 || i + batchSize >= rows.length) {
      console.log(`  Progress: ${Math.min(i + batchSize, rows.length)}/${rows.length} | ${articlesProcessed} embedded (${totalChunks} chunks) | ${articlesSkipped} skipped | ${errors} errors`);
    }

    await sleep(DELAY_MS);
  }

  console.log('\n=== Summary ===');
  console.log(`  Articles embedded: ${articlesProcessed}`);
  console.log(`  Total chunks:      ${totalChunks}`);
  console.log(`  Skipped:           ${articlesSkipped}`);
  console.log(`  Errors:            ${errors}`);

  process.exit(0);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

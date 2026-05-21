/**
 * Re-embed all track query embeddings and rebuild OpenSearch indexes
 * with the correct dimension from the running embed service.
 *
 * This script:
 *  1. Deletes and recreates article_chunks and site_standard_chunks indexes
 *  2. Re-embeds all active track query embeddings in PostgreSQL
 *
 * Usage:
 *   node --env-file=.env --import tsx/esm src/scripts/reembedAll.ts [options]
 *
 * Options:
 *   --tracks-only     Only re-embed track queries (skip index recreation)
 *   --indexes-only    Only recreate indexes (skip track re-embedding)
 */

import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { embedText, checkEmbedHealth, getEmbedDimension } from '../track/embedClient.js';
import { getOsClient } from '../track/opensearch.js';

const args = process.argv.slice(2);
const tracksOnly = args.includes('--tracks-only');
const indexesOnly = args.includes('--indexes-only');

async function main() {
  console.log('=== Re-embed All ===\n');

  // 1. Check embed service
  const healthy = await checkEmbedHealth();
  if (!healthy) {
    console.error('❌ Embed service is not reachable.');
    process.exit(1);
  }

  const dim = await getEmbedDimension();
  console.log(`  Embed dimension: ${dim}\n`);

  const os = getOsClient();

  // ── Step 1: Recreate OpenSearch indexes ──────────────────────────────────
  if (!tracksOnly) {
    console.log('── Recreating OpenSearch indexes ──────────────────\n');

    // Delete article_chunks
    try {
      const exists = await os.indices.exists({ index: 'article_chunks' });
      if (exists.body) {
        await os.indices.delete({ index: 'article_chunks' });
        console.log('  🗑️  Deleted article_chunks index');
      } else {
        console.log('  ℹ️  article_chunks index does not exist');
      }
    } catch (err) {
      console.error('  ⚠️  Failed to delete article_chunks:', (err as Error).message);
    }

    // Delete site_standard_chunks
    try {
      const exists = await os.indices.exists({ index: 'site_standard_chunks' });
      if (exists.body) {
        await os.indices.delete({ index: 'site_standard_chunks' });
        console.log('  🗑️  Deleted site_standard_chunks index');
      } else {
        console.log('  ℹ️  site_standard_chunks index does not exist');
      }
    } catch (err) {
      console.error('  ⚠️  Failed to delete site_standard_chunks:', (err as Error).message);
    }

    // Recreate both (will use auto-detected dimension)
    const { ensureArticleIndex, ensureSiteStandardChunksIndex } = await import('../track/opensearch.js');
    await ensureArticleIndex();
    console.log(`  ✅ Recreated article_chunks index (dim=${dim})`);
    await ensureSiteStandardChunksIndex();
    console.log(`  ✅ Recreated site_standard_chunks index (dim=${dim})\n`);
  }

  // ── Step 2: Re-embed track queries ──────────────────────────────────────
  if (!indexesOnly) {
    console.log('── Re-embedding track queries ─────────────────────\n');

    const { rows: tracks } = await db.query<{ id: string; query: string | null; keywords: string[] }>(
      `SELECT id, query, keywords FROM tracks WHERE is_active = TRUE`
    );

    console.log(`  Found ${tracks.length} active tracks\n`);

    let embedded = 0;
    let skipped = 0;
    let errors = 0;

    for (const track of tracks) {
      // Use query if present, otherwise join keywords
      const text = track.query || track.keywords.join(' ');
      if (!text || text.trim().length < 3) {
        skipped++;
        continue;
      }

      try {
        const embedding = await embedText(text);
        if (!embedding || !Array.isArray(embedding) || embedding.length !== dim) {
          console.error(`  ⚠️  Track ${track.id}: wrong dimension ${embedding?.length}`);
          errors++;
          continue;
        }
        await db.query(
          'UPDATE tracks SET query_embedding = $2, updated_at = NOW() WHERE id = $1',
          [track.id, embedding]
        );
        embedded++;
      } catch (err) {
        errors++;
        console.error(`  ❌ Track ${track.id}: ${(err as Error).message}`);
      }
    }

    console.log(`\n  Tracks: ${embedded} embedded, ${skipped} skipped, ${errors} errors\n`);
  }

  console.log('=== Done ===');
  console.log('  Next steps:');
  console.log('  1. Run backfillEmbeddings.ts for site_standard_chunks');
  console.log('  2. Article chunks will populate as new articles are indexed');
  process.exit(0);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});

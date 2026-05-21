import { Job } from 'pg-boss';
import { franc } from 'franc';
import { logger } from '../lib/logger.js';
import { getOsClient, SITE_STANDARD_INDEX, SITE_STANDARD_CHUNKS_INDEX } from '../track/opensearch.js';
import { db } from '../db/client.js';
import { BskyAgent } from '@atproto/api';
import { resolvePds } from '../lib/pds.js';
import { getCachedProfile } from '../lib/pdsCache.js';
import { upsertSiteStandardArticle } from '../db/queries/siteStandard.js';
import { verifyDocument } from '../lib/verification.js';
import { chunkText } from '../lib/chunking.js';
import { embedTexts } from '../track/embedClient.js';

interface IndexSiteStandardData {
  postUri: string;
  did: string;
  record: any;
}

function extractTextFromBlocks(blocks: any[]): string {
  let text = '';
  for (const wrapper of blocks) {
    // Leaflet blocks are wrapped in a union type, usually inside the `block` property
    const block = wrapper.block || wrapper;
    
    if (block.$type === 'pub.leaflet.blocks.text' || 
        block.$type === 'pub.leaflet.blocks.header' || 
        block.$type === 'pub.leaflet.blocks.blockquote' || 
        block.$type === 'pub.leaflet.blocks.code') {
      text += (block.plaintext || '') + '\n\n';
    } else if (block.$type === 'pub.leaflet.blocks.website' || block.$type === 'pub.leaflet.blocks.iframe') {
      text += (block.url || block.src || '') + '\n\n';
    } else if (block.$type === 'pub.leaflet.blocks.image') {
      text += (block.alt || '') + '\n\n';
    }
  }
  return text.trim();
}

export function extractTextFromSiteStandard(record: any): string {
  let text = '';
  
  if (record.title) {
    text += record.title + '\n\n';
  }
  
  if (record.description) {
    text += record.description + '\n\n';
  }

  // WhiteWind / standard string-based markdown content
  if (record.content && typeof record.content === 'string') {
    text += record.content + '\n\n';
  }

  // Leaflet block-based content union
  if (record.content?.pages && Array.isArray(record.content.pages)) {
    for (const page of record.content.pages) {
      if (page.blocks && Array.isArray(page.blocks)) {
        text += extractTextFromBlocks(page.blocks) + '\n\n';
      }
    }
  }

  // Legacy Leaflet standalone document
  if (record.pages && Array.isArray(record.pages)) {
    for (const page of record.pages) {
      if (page.blocks && Array.isArray(page.blocks)) {
        text += extractTextFromBlocks(page.blocks) + '\n\n';
      }
    }
  }

  // WordPress / third-party plain text content
  if (record.textContent && typeof record.textContent === 'string') {
    text += record.textContent + '\n\n';
  }
  
  return text.trim();
}

// --- Content moderation ---
const BLOCKED_DOMAINS = new Set([
  // Adult / NSFW
  'e-hentai.org', 'exhentai.org', 'nhentai.net', 'hanime.tv',
  'hentaihaven.xxx', 'fakku.net', 'hitomi.la', 'tsumino.com',
  'pururin.to', 'pornhub.com', 'xvideos.com', 'xhamster.com',
  'redtube.com', 'youporn.com', 'tube8.com', 'spankbang.com',
  'xnxx.com', 'chaturbate.com', 'stripchat.com', 'onlyfans.com',
  'fansly.com', 'manyvids.com', 'clips4sale.com',
  // Spam / job aggregators / SEO farms
  'jobs.now', 'www.jobs.now',
]);

const BLOCKED_CONTENT_PATTERNS = /\b(hentai|doujinshi|nsfw|xxx|porn|erotic[a]?|blowjob|milf|dilf|bbm|sex.?scene|nude|naked|genitalia|explicit.?content|r-?18|adult.?content)\b/i;

// Load additional blocked/suppressed domains from DB (cached, refreshes every 5 min)
let dbBlockedDomains: Set<string> = new Set();
let dbSuppressedDomains: Set<string> = new Set();
let dbBlocklistLastFetch = 0;
async function refreshModerationList(): Promise<void> {
  const now = Date.now();
  if (now - dbBlocklistLastFetch > 5 * 60 * 1000) {
    try {
      const { rows } = await db.query('SELECT domain, action FROM moderation_blocklist WHERE active = true');
      const blocked = new Set<string>();
      const suppressed = new Set<string>();
      for (const r of rows) {
        if (r.action === 'suppress') {
          suppressed.add(r.domain);
        } else {
          blocked.add(r.domain);
        }
      }
      dbBlockedDomains = blocked;
      dbSuppressedDomains = suppressed;
      dbBlocklistLastFetch = now;
    } catch {
      // Table may not exist yet — that's fine
    }
  }
}

function extractHostname(record: any): string | null {
  const site = record.site || '';
  if (typeof site === 'string' && site.startsWith('http')) {
    try { return new URL(site).hostname.replace(/^www\./, ''); } catch {}
  }
  return null;
}

async function isBlockedContent(record: any): Promise<boolean> {
  // Check domain against hardcoded + DB blocklist
  const hostname = extractHostname(record);
  if (hostname) {
    if (BLOCKED_DOMAINS.has(hostname)) return true;
    await refreshModerationList();
    if (dbBlockedDomains.has(hostname)) return true;
  }

  // Check text content for NSFW patterns
  const textToCheck = [
    record.title || '',
    record.description || '',
    record.textContent || '',
    ...(record.tags || []),
  ].join(' ');

  return BLOCKED_CONTENT_PATTERNS.test(textToCheck);
}

async function isSuppressedContent(record: any): Promise<boolean> {
  const hostname = extractHostname(record);
  if (!hostname) return false;
  await refreshModerationList();
  return dbSuppressedDomains.has(hostname);
}

export async function indexSiteStandardJob(job: Job<IndexSiteStandardData>) {
  const { postUri, did, record } = job.data;
  
  try {
    // Content moderation check
    if (await isBlockedContent(record)) {
      logger.info({ uri: postUri, site: record.site, title: record.title?.substring(0, 60) }, 'Skipped NSFW content');
      return;
    }

    const title = record.title || null;
    const description = record.description || null;
    const publishedAt = record.publishedAt ? new Date(record.publishedAt) : (record.createdAt ? new Date(record.createdAt) : new Date());
    let site = record.site || null;
    const path = record.path || null;
    
    // Resolve AT URI site to HTTP URL via publication cache/fetch
    if (site && site.startsWith('at://') && site.includes('site.standard.publication')) {
      try {
        const cacheRes = await db.query('SELECT url FROM site_publications WHERE uri = $1', [site]);
        if (cacheRes.rowCount !== null && cacheRes.rowCount > 0) {
          site = cacheRes.rows[0].url;
        } else {
          // Fallback to fetch from PDS
          const [siteDid, , rkey] = site.replace('at://', '').split('/');
          const pdsEndpoint = await resolvePds(siteDid);
          const agent = new BskyAgent({ service: pdsEndpoint });
          const pdsRes = await agent.com.atproto.repo.getRecord({
            repo: siteDid,
            collection: 'site.standard.publication',
            rkey
          });
          const pubUrl = (pdsRes.data.value as any).url;
          if (pubUrl && typeof pubUrl === 'string') {
            site = pubUrl;
            await db.query(
              'INSERT INTO site_publications (uri, url, raw_record) VALUES ($1, $2, $3) ON CONFLICT (uri) DO NOTHING',
              [record.site, pubUrl, pdsRes.data.value]
            );
          }
        }
      } catch (err) {
        logger.warn({ err, site }, 'Failed to resolve site.standard.publication for AT URI');
      }
    }
    
    // 2. Extract full text
    const textContent = extractTextFromSiteStandard(record);
    const wordCount = textContent ? textContent.trim().split(/\s+/).length : 0;

    // 3. Detect language
    let language = 'und';
    if (record.langs && Array.isArray(record.langs) && record.langs.length > 0) {
      language = record.langs[0];
    } else if (textContent) {
      language = franc(textContent, { minLength: 5 });
    }

    // 4. Check if this content should be suppressed from feeds (but still indexed)
    const suppressed = await isSuppressedContent(record);
    if (suppressed) {
      logger.info({ uri: postUri, site: record.site, title: title?.substring(0, 60) }, 'Indexed as suppressed (hidden from Latest)');
    }
    
    // 5. Resolve author handle (for BridgyFed detection and display)
    let authorHandle: string | null = null;
    try {
      const profile = await getCachedProfile(did);
      authorHandle = profile.handle || null;
    } catch { /* non-fatal — handle stays null */ }

    // 6. Save core metadata to Postgres
    await upsertSiteStandardArticle(postUri, did, authorHandle, title, description, publishedAt, site, path, record, language, wordCount, suppressed);
    
    // 3. Index to OpenSearch
    const os = getOsClient();
    await os.index({
      index: SITE_STANDARD_INDEX,
      id: postUri,
      body: {
        uri: postUri,
        did: did,
        title: title,
        text_content: textContent,
        published_at: publishedAt.toISOString(),
        site: site,
        path: path,
        language: language,
        word_count: wordCount,
        bsky_post_uri: record.bskyPostRef?.uri || null
      }
    });
    
    logger.info({ uri: postUri, did }, 'Successfully indexed site.standard.document');

    // 4. Chunk + embed for semantic search (skip short posts)
    if (wordCount >= 50) {
      setImmediate(async () => {
        try {
          const chunks = chunkText(textContent);
          if (chunks.length === 0) return;

          const { embeddings } = await embedTexts(chunks);
          if (embeddings.length !== chunks.length) return;

          // Build bulk body
          const bulkBody: any[] = [];
          for (let i = 0; i < chunks.length; i++) {
            bulkBody.push({ index: { _index: SITE_STANDARD_CHUNKS_INDEX, _id: `${postUri}_chunk_${i}` } });
            bulkBody.push({
              uri: postUri,
              did: did,
              chunk_index: i,
              published_at: publishedAt.toISOString(),
              text_content: chunks[i],
              site: site,
              language: language,
              embedding: embeddings[i],
            });
          }

          const os = getOsClient();
          const res = await os.bulk({ body: bulkBody });
          if (res.body.errors) {
            logger.warn({ uri: postUri }, 'Some chunks failed to index');
          } else {
            logger.debug({ uri: postUri, chunks: chunks.length }, 'Indexed document chunks with embeddings');
          }
        } catch (err) {
          logger.debug({ err, uri: postUri }, 'Chunk+embed failed (non-fatal)');
        }
      });
    }

    // 7. Async verification — never blocks indexing
    setImmediate(async () => {
      try {
        const publicationUri = (record.site && typeof record.site === 'string' && record.site.startsWith('at://')) ? record.site : null;
        const verified = await verifyDocument(postUri, site, path, publicationUri);
        await db.query(
          'UPDATE site_standard_articles SET verified = $1, verified_at = NOW() WHERE uri = $2',
          [verified, postUri]
        );
        if (verified) {
          logger.info({ uri: postUri }, 'Document verified via standard.site');
        }
      } catch (err) {
        logger.debug({ err, uri: postUri }, 'Verification step failed (non-fatal)');
      }
    });
  } catch (err) {
    logger.error({ err, uri: postUri }, 'Failed to index site.standard.document');
    throw err;
  }
}

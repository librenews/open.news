import { Job } from 'pg-boss';
import { franc } from 'franc';
import { logger } from '../lib/logger.js';
import { getOsClient, SITE_STANDARD_INDEX } from '../track/opensearch.js';
import { db } from '../db/client.js';
import { BskyAgent } from '@atproto/api';
import { resolvePds } from '../lib/pds.js';
import { upsertSiteStandardArticle } from '../db/queries/siteStandard.js';

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
  
  return text.trim();
}

export async function indexSiteStandardJob(job: Job<IndexSiteStandardData>) {
  const { postUri, did, record } = job.data;
  
  try {
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
          const pubUrl = pdsRes.data.value.url;
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
    
    // 4. Save core metadata to Postgres
    await upsertSiteStandardArticle(postUri, did, title, description, publishedAt, site, path, record, language, wordCount);
    
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
  } catch (err) {
    logger.error({ err, uri: postUri }, 'Failed to index site.standard.document');
    throw err;
  }
}

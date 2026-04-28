import { Job } from 'pg-boss';
import { logger } from '../lib/logger.js';
import { getOsClient, SITE_STANDARD_INDEX } from '../track/opensearch.js';
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

function extractTextFromSiteStandard(record: any): string {
  let text = '';
  
  if (record.title) {
    text += record.title + '\n\n';
  }
  
  if (record.description) {
    text += record.description + '\n\n';
  }

  if (record.content?.pages && Array.isArray(record.content.pages)) {
    for (const page of record.content.pages) {
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
    const publishedAt = record.createdAt ? new Date(record.createdAt) : new Date();
    
    // 1. Save core metadata to Postgres
    await upsertSiteStandardArticle(postUri, did, title, description, publishedAt);
    
    // 2. Extract full text
    const textContent = extractTextFromSiteStandard(record);
    
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
        published_at: publishedAt.toISOString()
      }
    });
    
    logger.info({ uri: postUri, did }, 'Successfully indexed site.standard.document');
  } catch (err) {
    logger.error({ err, uri: postUri }, 'Failed to index site.standard.document');
    throw err;
  }
}

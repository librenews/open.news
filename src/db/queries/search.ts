import { getOsClient, ARTICLE_INDEX } from '../../track/opensearch.js';
import { logger } from '../../lib/logger.js';

/**
 * Bulk indexes an array of text chunks and their corresponding embeddings into OpenSearch.
 */
export async function indexArticleChunks(
  articleId: bigint | number | string,
  chunks: string[],
  embeddings: number[][]
): Promise<void> {
  if (chunks.length === 0 || chunks.length !== embeddings.length) {
    logger.warn({ articleId, chunksLen: chunks.length, embedLen: embeddings.length }, 'Invalid chunks or embeddings arrays for indexing');
    return;
  }

  const os = getOsClient();
  const body = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkId = `article_${articleId}_chunk_${i}`;
    
    // Action description
    body.push({ index: { _index: ARTICLE_INDEX, _id: chunkId } });
    
    // Document
    body.push({
      article_id: String(articleId), // Keep keywords as string conceptually
      chunk_index: i,
      text_content: chunks[i],
      embedding: embeddings[i],
    });
  }

  try {
    const response = await os.bulk({ refresh: 'true', body });
    if (response.body.errors) {
      logger.error({ errors: response.body.items }, 'Errors occurred during OpenSearch bulk indexing');
    } else {
      logger.debug({ articleId, count: chunks.length }, 'Successfully indexed article chunks into OpenSearch');
    }
  } catch (err) {
    logger.error({ err, articleId }, 'Failed to bulk index article chunks');
    throw err;
  }
}

import { getOsClient, ARTICLE_INDEX } from '../../track/opensearch.js';
import { logger } from '../../lib/logger.js';

/**
 * Bulk indexes an array of text chunks and their corresponding embeddings into OpenSearch.
 */
export async function indexArticleChunks(
  articleId: bigint | number | string,
  chunks: string[],
  embeddings: number[][],
  publishedAt: Date | null
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
      published_at: publishedAt ? publishedAt.toISOString() : null,
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

/**
 * Searches the semantic chunks for the top matches to a given embedding.
 * Uses function_score over K-NN to apply an exponential time decay.
 */
export async function findSemanticArticlesContext(
  queryEmbedding: number[],
  limit = 5
): Promise<{ text_content: string; article_id: string; score: number }[]> {
  const os = getOsClient();

  // Decay config: half-life of 7 days
  // scale="7d", decay=0.5 means a score 7 days old is multiplied by 0.5.
  try {
    const response = await os.search({
      index: ARTICLE_INDEX,
      body: {
        size: limit * 3, // Over-fetch to gather diverse article IDs
        query: {
          function_score: {
            query: {
              knn: {
                embedding: {
                  vector: queryEmbedding,
                  k: 30,
                },
              },
            },
            functions: [
              {
                exp: {
                  published_at: {
                    origin: "now",
                    scale: "7d",
                    offset: "1h",
                    decay: 0.5
                  }
                }
              }
            ],
            score_mode: "multiply",
            boost_mode: "multiply"
          }
        }
      }
    });

    const hits = response.body.hits?.hits ?? [];
    
    // Deduplicate by article_id (keep the highest scoring chunk per article)
    const seenArticles = new Set<string>();
    const bestChunks: { text_content: string; article_id: string; score: number }[] = [];
    
    for (const h of hits) {
      if (!h._source) continue;
      const src = h._source as { article_id: string; text_content: string };
      if (!seenArticles.has(src.article_id)) {
        seenArticles.add(src.article_id);
        bestChunks.push({
          article_id: src.article_id,
          text_content: src.text_content,
          score: Number(h._score ?? 0),
        });
        if (bestChunks.length >= limit) break;
      }
    }
    
    return bestChunks;
  } catch (err) {
    logger.error({ err }, 'Failed to execute semantic search context query');
    return [];
  }
}

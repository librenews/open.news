import { Client } from '@opensearch-project/opensearch';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

const PERCOLATE_INDEX = 'track_queries';

let client: Client | null = null;

export function getOsClient(): Client {
  if (!client) {
    client = new Client({
      node: config.OPENSEARCH_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return client;
}

/** Ensure the percolate index exists with keyword mapping (no knn needed). */
export async function ensureIndex(): Promise<void> {
  const os = getOsClient();
  const exists = await os.indices.exists({ index: PERCOLATE_INDEX });
  if (exists.body) return;

  await os.indices.create({
    index: PERCOLATE_INDEX,
    body: {
      mappings: {
        properties: {
          text: { type: 'text', analyzer: 'standard' },
          did: { type: 'keyword' },
          uri: { type: 'keyword' },
          query: { type: 'percolator' },
        },
      },
    },
  });
  logger.info('OpenSearch percolate index created');
}

export const ARTICLE_INDEX = 'article_chunks';

/** Ensure the articles index exists with knn vector mapping. */
export async function ensureArticleIndex(): Promise<void> {
  const os = getOsClient();
  const exists = await os.indices.exists({ index: ARTICLE_INDEX });
  if (exists.body) return;

  await os.indices.create({
    index: ARTICLE_INDEX,
    body: {
      settings: {
        index: {
          knn: true
        }
      },
      mappings: {
        properties: {
          article_id: { type: 'keyword' },
          chunk_index: { type: 'integer' },
          published_at: { type: 'date' },
          text_content: { type: 'text' },
          embedding: { 
            type: 'knn_vector', 
            dimension: config.EMBED_DIMENSION, 
            method: {
              name: 'hnsw',
              space_type: 'cosinesimil',
              engine: 'nmslib'
            }
          },
        },
      },
    },
  });
  logger.info('OpenSearch article index created');
}

/** Utility to destroy the article chunks index so mappings can be recreated */
export async function dropArticleIndex(): Promise<void> {
  const os = getOsClient();
  try {
    await os.indices.delete({ index: ARTICLE_INDEX });
    logger.info('OpenSearch article index dropped');
  } catch (err) {
    logger.warn({ err }, 'Failed to drop article index (it may not exist)');
  }
}

/**
 * Store a keyword-only percolate query for a track.
 * Semantic matching is handled separately in the worker via cosine similarity.
 */
export async function upsertTrackQuery(
  trackId: bigint | number,
  keywords: string[],
): Promise<string> {
  const os = getOsClient();
  const docId = `track_${trackId}`;

  if (keywords.length === 0) {
    // No keywords — store a match_all so percolate still returns this track
    // (semantic matching in the worker will filter by similarity)
    await os.index({
      index: PERCOLATE_INDEX,
      id: docId,
      body: {
        query: { match_all: {} },
      },
      refresh: 'true',
    });
    return docId;
  }

  // Keyword-only percolate query
  const should = keywords.map((kw) => ({ match_phrase: { text: kw } }));
  await os.index({
    index: PERCOLATE_INDEX,
    id: docId,
    body: {
      query: { bool: { should, minimum_should_match: 1 } },
    },
    refresh: 'true',
  });

  return docId;
}

/** Remove a percolate query. */
export async function deleteTrackQuery(trackId: bigint | number): Promise<void> {
  const os = getOsClient();
  try {
    await os.delete({
      index: PERCOLATE_INDEX,
      id: `track_${trackId}`,
      refresh: 'true',
    });
  } catch {
    // Ignore if not found
  }
}

/** Percolate a post against keyword-based track queries. Returns matching track IDs. */
export async function percolatePost(
  text: string,
  did: string,
  uri: string,
): Promise<number[]> {
  const os = getOsClient();
  const res = await os.search({
    index: PERCOLATE_INDEX,
    body: {
      query: {
        percolate: {
          field: 'query',
          document: { text, did, uri },
        },
      },
    },
  });

  const hits = res.body.hits?.hits ?? [];
  return hits
    .map((h: { _id: string }) => {
      const match = h._id.match(/^track_(\d+)$/);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter((id: number | null): id is number => id !== null);
}

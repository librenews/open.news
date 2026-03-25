import { Client } from '@opensearch-project/opensearch';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { embedText } from './embedClient.js';

const PERCOLATE_INDEX = 'track_queries';
const EMBEDDING_DIM = 1024;

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

/** Ensure the percolate index exists with keyword + knn_vector mapping. */
export async function ensureIndex(): Promise<void> {
  const os = getOsClient();
  const exists = await os.indices.exists({ index: PERCOLATE_INDEX });
  if (exists.body) return;

  await os.indices.create({
    index: PERCOLATE_INDEX,
    body: {
      settings: {
        'index.knn': true,
      },
      mappings: {
        properties: {
          text: { type: 'text', analyzer: 'standard' },
          embedding: {
            type: 'knn_vector',
            dimension: EMBEDDING_DIM,
            method: { name: 'hnsw', space_type: 'cosinesimil', engine: 'lucene' },
          },
          did: { type: 'keyword' },
          uri: { type: 'keyword' },
          query: { type: 'percolator' },
        },
      },
    },
  });
  logger.info('OpenSearch percolate index created (hybrid: keywords + knn_vector)');
}

/**
 * Store a hybrid percolate query for a track.
 *
 * The track can have:
 * - keywords: matched via match_phrase (existing behavior)
 * - semanticQuery: natural language, embedded and matched via cosine similarity
 * - both: hybrid — either branch matching triggers a hit
 *
 * @param trackId - Track ID for the document ID
 * @param keywords - Optional keyword list for exact phrase matching
 * @param semanticQuery - Optional natural language query to embed for semantic matching
 * @param threshold - Minimum cosine similarity score for semantic matching (0-1)
 */
export async function upsertTrackQuery(
  trackId: bigint | number,
  keywords: string[],
  semanticQuery?: string,
  threshold: number = 0.65,
): Promise<string> {
  const os = getOsClient();
  const docId = `track_${trackId}`;

  // Build the hybrid query clauses
  const should: object[] = [];

  // 1. Keyword matches (match_phrase for each keyword)
  for (const kw of keywords) {
    should.push({ match_phrase: { text: kw } });
  }

  // 2. Semantic similarity (script_score with cosine similarity)
  if (semanticQuery) {
    const queryEmbedding = await embedText(semanticQuery);
    should.push({
      script_score: {
        query: { match_all: {} },
        script: {
          source: `cosineSimilarity(params.query_vector, 'embedding') >= params.threshold ? _score + cosineSimilarity(params.query_vector, 'embedding') : 0`,
          params: {
            query_vector: queryEmbedding,
            threshold,
          },
        },
      },
    });
  }

  if (should.length === 0) {
    throw new Error('Track must have at least keywords or a semantic query');
  }

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

/**
 * Percolate a post against all stored track queries.
 * Passes both text (for keyword matching) and embedding (for semantic matching).
 * Returns matching track IDs.
 */
export async function percolatePost(
  text: string,
  did: string,
  uri: string,
  embedding: number[],
): Promise<number[]> {
  const os = getOsClient();
  const res = await os.search({
    index: PERCOLATE_INDEX,
    body: {
      query: {
        percolate: {
          field: 'query',
          document: { text, did, uri, embedding },
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

import { Client } from '@opensearch-project/opensearch';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { getEmbedDimension } from './embedClient.js';

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
export const SITE_STANDARD_INDEX = 'site_standard_docs';
export const SITE_STANDARD_CHUNKS_INDEX = 'site_standard_chunks';
export const MEDIA_INDEX = 'media_content';

/** Ensure the articles index exists with knn vector mapping. */
export async function ensureArticleIndex(): Promise<void> {
  const os = getOsClient();
  const exists = await os.indices.exists({ index: ARTICLE_INDEX });
  if (exists.body) return;

  const dimension = await getEmbedDimension();

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
            dimension: dimension, 
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

/** Ensure the site.standard.document chunks index exists with knn vector mapping. */
export async function ensureSiteStandardChunksIndex(): Promise<void> {
  const os = getOsClient();
  const exists = await os.indices.exists({ index: SITE_STANDARD_CHUNKS_INDEX });
  if (exists.body) return;

  const dimension = await getEmbedDimension();

  await os.indices.create({
    index: SITE_STANDARD_CHUNKS_INDEX,
    body: {
      settings: {
        index: { knn: true }
      },
      mappings: {
        properties: {
          uri: { type: 'keyword' },
          did: { type: 'keyword' },
          chunk_index: { type: 'integer' },
          published_at: { type: 'date' },
          text_content: { type: 'text' },
          site: { type: 'keyword' },
          language: { type: 'keyword' },
          embedding: {
            type: 'knn_vector',
            dimension: dimension,
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
  logger.info('OpenSearch site_standard_chunks index created');
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

/** Ensure the site.standard.document index exists. */
export async function ensureSiteStandardIndex(): Promise<void> {
  const os = getOsClient();
  const exists = await os.indices.exists({ index: SITE_STANDARD_INDEX });
  
  const mapping = {
    properties: {
      uri: { type: 'keyword' },
      did: { type: 'keyword' },
      title: { 
        type: 'text',
        fields: {
          en: { type: 'text', analyzer: 'english' },
          es: { type: 'text', analyzer: 'spanish' },
          fr: { type: 'text', analyzer: 'french' },
          de: { type: 'text', analyzer: 'german' },
          cjk: { type: 'text', analyzer: 'cjk' }
        }
      },
      text_content: { 
        type: 'text',
        fields: {
          en: { type: 'text', analyzer: 'english' },
          es: { type: 'text', analyzer: 'spanish' },
          fr: { type: 'text', analyzer: 'french' },
          de: { type: 'text', analyzer: 'german' },
          cjk: { type: 'text', analyzer: 'cjk' }
        }
      },
      published_at: { type: 'date' },
      site: { type: 'keyword' },
      path: { type: 'keyword' },
      language: { type: 'keyword' },
      verified: { type: 'boolean' },
    },
  };

  if (!exists.body) {
    await os.indices.create({
      index: SITE_STANDARD_INDEX,
      body: { mappings: mapping },
    });
  } else {
    // Safely add new multi-fields to existing index
    await os.indices.putMapping({
      index: SITE_STANDARD_INDEX,
      body: mapping,
    });
  }
  logger.info('OpenSearch site_standard_docs index ensured');
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

/**
 * Searches the site.standard.document index using multi-language fields and highlighting.
 */
export async function searchSiteStandardArticles(query: string, len: 'all' | 'long' = 'all', sortBy: 'relevant' | 'recent' = 'relevant', limit: number = 20, verifiedOnly: boolean = false, from: number = 0) {
  const os = getOsClient();
  
  const must: any[] = [
    {
      multi_match: {
        query: query,
        fields: ['title^2', 'title.*^2', 'text_content', 'text_content.*'],
        type: 'most_fields',
      }
    }
  ];

  if (len === 'long') {
    must.push({
      range: {
        word_count: { gte: 100 }
      }
    });
  }

  const filter: any[] = [];
  if (verifiedOnly) {
    filter.push({ term: { verified: true } });
  }

  const body: any = {
    from,
    size: limit,
    track_total_hits: true,
    query: {
      bool: {
        must: must,
        ...(filter.length > 0 ? { filter } : {}),
      }
    },
    highlight: {
      fields: {
        'text_content': {},
        'text_content.*': {}
      },
      pre_tags: ['<em class="bg-indigo-100 text-indigo-900 font-bold px-0.5 rounded">'],
      post_tags: ['</em>'],
    },
    _source: ['title', 'did', 'site', 'path', 'language', 'published_at', 'uri', 'bsky_post_uri', 'word_count', 'verified'],
  };

  if (sortBy === 'recent') {
    body.sort = [
      { published_at: { order: 'desc', unmapped_type: 'date' } },
      '_score'
    ];
  }

  const res = await os.search({
    index: SITE_STANDARD_INDEX,
    body,
  });

  return res.body.hits;
}

/**
 * Finds related articles to a given URI using OpenSearch's More Like This query.
 */
export async function getRelatedArticles(uri: string, limit: number = 3) {
  const os = getOsClient();
  const res = await os.search({
    index: SITE_STANDARD_INDEX,
    body: {
      size: limit,
      query: {
        more_like_this: {
          fields: ['title^2', 'title.*^2', 'text_content', 'text_content.*'],
          like: [
            {
              _index: SITE_STANDARD_INDEX,
              _id: uri
            }
          ],
          min_term_freq: 1,
          max_query_terms: 25,
          min_word_length: 3
        }
      },
      _source: ['title', 'did', 'site', 'path', 'language', 'published_at', 'uri', 'word_count']
    }
  });
  return res.body.hits?.hits || [];
}

/** Ensure the media content index exists with vector mapping for audio embeddings. */
export async function ensureMediaIndex(): Promise<void> {
  const os = getOsClient();
  const exists = await os.indices.exists({ index: MEDIA_INDEX });
  if (exists.body) return;

  await os.indices.create({
    index: MEDIA_INDEX,
    body: {
      settings: {
        index: {
          knn: true
        }
      },
      mappings: {
        properties: {
          uri: { type: 'keyword' },
          did: { type: 'keyword' },
          media_type: { type: 'keyword' },
          source_url: { type: 'keyword' },
          alt_text: { type: 'text', analyzer: 'standard' },
          post_text: { type: 'text', analyzer: 'standard' },
          transcript: { type: 'text', analyzer: 'standard' },
          language: { type: 'keyword' },
          duration_ms: { type: 'integer' },
          created_at: { type: 'date' },
          audio_embedding: {
            type: 'knn_vector',
            dimension: 512,
            method: {
              name: 'hnsw',
              space_type: 'cosinesimil',
              engine: 'nmslib'
            }
          },
          is_news: { type: 'boolean' },
          story_labels: { type: 'keyword' },
          story_category: { type: 'keyword' },
          news_qualified_at: { type: 'date' },
        },
      },
    },
  });
  logger.info('OpenSearch media index created');
}

/**
 * Ensure the news fields exist on an already-created media index.
 * Safe to call repeatedly — put_mapping is additive.
 */
export async function ensureNewsFields(): Promise<void> {
  const os = getOsClient();
  try {
    await os.indices.putMapping({
      index: MEDIA_INDEX,
      body: {
        properties: {
          is_news: { type: 'boolean' },
          story_labels: { type: 'keyword' },
          story_category: { type: 'keyword' },
          news_qualified_at: { type: 'date' },
        },
      },
    });
    logger.info('News fields ensured on media index');
  } catch (err) {
    logger.warn({ err }, 'Failed to add news fields to media index (may already exist)');
  }
}

/**
 * Flag a media document as news-qualified and attach story labels.
 * Uses partial doc update so existing fields are preserved.
 */
export async function flagAsNews(
  uri: string,
  storyLabels: string[],
  storyCategory: string | null
): Promise<void> {
  const os = getOsClient();
  try {
    await os.update({
      index: MEDIA_INDEX,
      id: uri,
      body: {
        doc: {
          is_news: true,
          story_labels: storyLabels,
          story_category: storyCategory || undefined,
          news_qualified_at: new Date().toISOString(),
        },
      },
      retry_on_conflict: 3,
    });
  } catch (err) {
    logger.debug({ err, uri }, 'Failed to flag media as news in OpenSearch (non-fatal)');
  }
}

/**
 * Search only news-qualified media by transcript, post text, or alt text.
 */
export async function searchNewsContent(
  query: string,
  options: { category?: string; limit?: number; cursor?: string } = {}
) {
  const os = getOsClient();
  const { category, limit = 20, cursor } = options;

  const must: any[] = [
    {
      multi_match: {
        query,
        fields: ['transcript^3', 'post_text^1.5', 'alt_text'],
        type: 'most_fields',
      },
    },
  ];

  const filter: any[] = [
    { term: { is_news: true } },
  ];

  if (category) {
    filter.push({ term: { story_category: category } });
  }
  if (cursor) {
    filter.push({ range: { created_at: { lt: cursor } } });
  }

  const res = await os.search({
    index: MEDIA_INDEX,
    body: {
      size: limit,
      query: {
        bool: { must, filter },
      },
      sort: [{ _score: { order: 'desc' } }, { created_at: { order: 'desc' } }],
      _source: [
        'uri', 'did', 'post_text', 'transcript', 'duration_ms',
        'created_at', 'story_labels', 'story_category', 'news_qualified_at',
      ],
    },
  });

  return res.body.hits?.hits ?? [];
}

/**
 * Search media content by transcript, post text, or alt text using full-text search.
 */
export async function searchMediaContent(query: string, limit = 20, cursor?: string) {
  const os = getOsClient();
  const must: any[] = [
    {
      multi_match: {
        query: query,
        fields: ['transcript^3', 'post_text^1.5', 'alt_text'],
        type: 'most_fields',
      }
    }
  ];

  const filter: any[] = [];
  if (cursor) {
    filter.push({
      range: {
        created_at: { lt: cursor }
      }
    });
  }

  const res = await os.search({
    index: MEDIA_INDEX,
    body: {
      size: limit,
      query: {
        bool: {
          must: must,
          ...(filter.length > 0 ? { filter } : {}),
        }
      },
      sort: [
        { created_at: { order: 'desc' } }
      ]
    }
  });

  return res.body.hits?.hits ?? [];
}

/**
 * Find related videos using vector search (CLAP similarity) or fallback text match.
 */
export async function getRelatedVideos(mediaUri: string, embedding?: number[], transcript?: string, limit = 4) {
  const os = getOsClient();
  try {
    if (embedding && embedding.length === 512) {
      const res = await os.search({
        index: MEDIA_INDEX,
        body: {
          size: limit + 2, // fetch slightly more so we can filter out original uri
          query: {
            knn: {
              audio_embedding: {
                vector: embedding,
                k: limit + 2
              }
            }
          }
        }
      });
      const hits = res.body.hits?.hits ?? [];
      return hits
        .filter((h: any) => h._source.uri && h._source.uri !== mediaUri)
        .slice(0, limit);
    }
  } catch (err) {
    logger.debug({ err, mediaUri }, 'Vector similarity search failed, falling back to text matching');
  }

  // Fallback to text similarity using transcript
  if (transcript && transcript.length > 5 && transcript !== 'silent') {
    try {
      const res = await os.search({
        index: MEDIA_INDEX,
        body: {
          size: limit + 2,
          query: {
            bool: {
              must: [
                {
                  multi_match: {
                    query: transcript,
                    fields: ['transcript^2', 'post_text'],
                  }
                }
              ],
              must_not: [
                { term: { uri: mediaUri } }
              ]
            }
          }
        }
      });
      return res.body.hits?.hits ?? [];
    } catch (err) {
      logger.error({ err }, 'Fallback related search failed');
    }
  }

  return [];
}

/** Remove a media document from the media index. */
export async function deleteMediaDocument(uri: string): Promise<void> {
  const os = getOsClient();
  try {
    await os.delete({
      index: MEDIA_INDEX,
      id: uri,
      refresh: 'true',
    });
  } catch {
    // Ignore if not found or failed
  }
}

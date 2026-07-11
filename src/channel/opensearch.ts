/**
 * OpenSearch percolator index for matching video transcripts to active news stories.
 * Follows the same pattern as src/track/opensearch.ts (upsertTrackQuery, percolatePost).
 */
import { getOsClient } from '../track/opensearch.js';
import { logger } from '../lib/logger.js';

export const CHANNEL_STORIES_INDEX = 'channel_stories_queries';

/** Ensure the channel stories percolator index exists. */
export async function ensureChannelStoriesIndex(): Promise<void> {
  const os = getOsClient();
  const exists = await os.indices.exists({ index: CHANNEL_STORIES_INDEX });
  if (exists.body) return;

  await os.indices.create({
    index: CHANNEL_STORIES_INDEX,
    body: {
      mappings: {
        properties: {
          text: { type: 'text', analyzer: 'standard' },
          query: { type: 'percolator' },
          story_id: { type: 'keyword' },
          importance: { type: 'float' },
        },
      },
    },
  });
  logger.info('OpenSearch channel stories percolator index created');
}

/** Upsert a percolator query for a story. */
export async function upsertStoryQuery(storyId: string, keywords: string[]): Promise<void> {
  const os = getOsClient();
  if (keywords.length === 0) return;

  const should = keywords.map(kw => ({ match_phrase: { text: kw } }));
  await os.index({
    index: CHANNEL_STORIES_INDEX,
    id: storyId,
    body: {
      story_id: storyId,
      query: { bool: { should, minimum_should_match: 1 } },
    },
    refresh: 'true',
  });
}

/** Delete a story percolator query. */
export async function deleteStoryQuery(storyId: string): Promise<void> {
  const os = getOsClient();
  try {
    await os.delete({ index: CHANNEL_STORIES_INDEX, id: storyId, refresh: 'true' });
  } catch {
    // Ignore if not found
  }
}

/** Percolate a transcript against stored story queries. Returns matching story IDs. */
export async function percolateTranscript(transcript: string): Promise<{ storyId: string; score: number }[]> {
  const os = getOsClient();
  const res = await os.search({
    index: CHANNEL_STORIES_INDEX,
    body: {
      query: {
        percolate: {
          field: 'query',
          document: { text: transcript },
        },
      },
    },
  });

  const hits = res.body.hits?.hits ?? [];
  return hits.map((h: any) => ({
    storyId: h._id as string,
    score: h._score as number,
  }));
}

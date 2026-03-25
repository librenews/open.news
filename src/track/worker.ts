import { Redis } from 'ioredis';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { ensureIndex, percolatePost } from './opensearch.js';
import { insertTrackMatch, getTracksWithEmbeddings, TrackWithEmbedding } from '../db/queries/tracks.js';
import { embedTexts, checkEmbedHealth } from './embedClient.js';

const STREAM_KEY = 'track:posts';
const GROUP_NAME = 'track-workers';
const CONSUMER_NAME = `worker-${process.pid}`;
const BATCH_SIZE = 64;
const BLOCK_MS = 2000;
const STATS_KEY = 'track:stats';
const LAG_LOG_INTERVAL = 30_000; // log lag every 30s
let lastLagLog = 0;

// Cache track embeddings — refresh every 30s
let cachedTracks: TrackWithEmbedding[] = [];
let cacheAge = 0;
const CACHE_TTL = 30_000;

async function getTrackEmbeddings(): Promise<TrackWithEmbedding[]> {
  if (Date.now() - cacheAge > CACHE_TTL) {
    cachedTracks = await getTracksWithEmbeddings();
    cacheAge = Date.now();
    if (cachedTracks.length > 0) {
      logger.debug({ count: cachedTracks.length }, 'Refreshed track embeddings cache');
    }
  }
  return cachedTracks;
}

/** Cosine similarity between two normalized vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot; // Both vectors are L2-normalized by the embed service
}

/**
 * Two-phase matching:
 * 1. Keyword matching via OpenSearch percolate
 * 2. Semantic matching via cosine similarity against track query embeddings
 * Returns deduplicated set of matching track IDs.
 */
async function matchPost(
  text: string,
  did: string,
  uri: string,
  postEmbedding: number[],
): Promise<number[]> {
  const matchedIds = new Set<number>();

  // Phase 1: Keyword percolate
  try {
    const keywordMatches = await percolatePost(text, did, uri);
    for (const id of keywordMatches) matchedIds.add(id);
  } catch (err) {
    logger.error({ err, uri }, 'Keyword percolate failed');
  }

  // Phase 2: Semantic similarity
  const tracks = await getTrackEmbeddings();
  for (const track of tracks) {
    const similarity = cosineSimilarity(postEmbedding, track.query_embedding);
    if (similarity >= track.threshold) {
      matchedIds.add(track.id);
    }
  }

  return Array.from(matchedIds);
}

async function ensureConsumerGroup(redis: Redis): Promise<void> {
  try {
    await redis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '0', 'MKSTREAM');
    logger.info('Created consumer group');
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('BUSYGROUP')) return;
    throw err;
  }
}

interface Post {
  messageId: string;
  did: string;
  text: string;
  uri: string;
}

async function processMessages(redis: Redis): Promise<void> {
  const results = await redis.xreadgroup(
    'GROUP', GROUP_NAME, CONSUMER_NAME,
    'COUNT', BATCH_SIZE,
    'BLOCK', BLOCK_MS,
    'STREAMS', STREAM_KEY, '>'
  );

  if (!results) return;

  type StreamMessage = [id: string, fields: string[]];
  type StreamResult = [key: string, messages: StreamMessage[]];
  const streams = results as StreamResult[];

  // 1. Collect all posts
  const posts: Post[] = [];
  const ackIds: string[] = [];

  for (const [, messages] of streams) {
    for (const [messageId, fields] of messages) {
      const data: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        data[fields[i]] = fields[i + 1];
      }

      if (!data.text) {
        ackIds.push(messageId);
        continue;
      }

      posts.push({ messageId, did: data.did, text: data.text, uri: data.uri });
    }
  }

  if (posts.length === 0) {
    if (ackIds.length > 0) {
      await redis.xack(STREAM_KEY, GROUP_NAME, ...ackIds);
    }
    return;
  }

  // 2. Batch embed all texts
  let embeddings: number[][];
  const embedStart = Date.now();
  try {
    embeddings = await embedTexts(posts.map((p) => p.text));
  } catch (err) {
    logger.error({ err, count: posts.length }, 'Batch embedding failed');
    await redis.xack(STREAM_KEY, GROUP_NAME, ...posts.map((p) => p.messageId), ...ackIds);
    return;
  }
  const embedMs = Date.now() - embedStart;

  // 3. Two-phase match each post and store matches
  let totalMatches = 0;
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    try {
      const matchedTrackIds = await matchPost(post.text, post.did, post.uri, embeddings[i]);
      for (const trackId of matchedTrackIds) {
        await insertTrackMatch(trackId, post.uri, post.did, post.text);
      }
      totalMatches += matchedTrackIds.length;
    } catch (err) {
      logger.error({ err, uri: post.uri }, 'Match failed');
    }
  }

  if (totalMatches > 0) {
    logger.info({ posts: posts.length, matches: totalMatches, embedMs }, 'Batch processed');
  }

  // 4. Bulk ACK
  await redis.xack(STREAM_KEY, GROUP_NAME, ...posts.map((p) => p.messageId), ...ackIds);

  // 5. Publish stats to Redis
  try {
    const pipeline = redis.pipeline();
    pipeline.hincrby(STATS_KEY, 'posts_processed', posts.length);
    pipeline.hincrby(STATS_KEY, 'matches_found', totalMatches);
    pipeline.hincrby(STATS_KEY, 'batches', 1);
    pipeline.hset(STATS_KEY, 'last_embed_ms', String(embedMs));
    pipeline.hset(STATS_KEY, 'last_batch_size', String(posts.length));
    pipeline.hset(STATS_KEY, 'last_batch_at', new Date().toISOString());
    await pipeline.exec();
  } catch {
    // Non-critical — don't fail batch for stats
  }

  // 6. Periodic lag check
  if (Date.now() - lastLagLog > LAG_LOG_INTERVAL) {
    lastLagLog = Date.now();
    try {
      const info = await redis.xinfo('GROUPS', STREAM_KEY) as Array<string[]>;
      if (info && info.length > 0) {
        // Parse XINFO GROUPS response
        const group = info[0] as unknown as string[];
        const lagIdx = group.indexOf('lag');
        const pendingIdx = group.indexOf('pending');
        const lag = lagIdx >= 0 ? Number(group[lagIdx + 1]) : -1;
        const pending = pendingIdx >= 0 ? Number(group[pendingIdx + 1]) : -1;
        logger.info({ lag, pending }, 'Stream lag check');

        // Also store in Redis for the stats endpoint
        await redis.hset(STATS_KEY, 'stream_lag', String(lag));
        await redis.hset(STATS_KEY, 'stream_pending', String(pending));
        await redis.hset(STATS_KEY, 'lag_checked_at', new Date().toISOString());
      }
    } catch (err) {
      logger.debug({ err }, 'Could not read stream info');
    }
  }
}

async function start(): Promise<void> {
  logger.info('Track worker starting');

  await ensureIndex();

  logger.info('Waiting for embed service...');
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    ready = await checkEmbedHealth();
    if (ready) break;
    logger.info({ attempt }, 'Embed service not ready, retrying in 2s...');
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!ready) {
    logger.warn('Embed service not available — starting worker anyway');
  } else {
    logger.info('Embed service ready');
  }

  const redis = new Redis(config.REDIS_URL);
  await ensureConsumerGroup(redis);

  logger.info('Track worker running — two-phase matching (keywords + semantic)');

  while (true) {
    try {
      await processMessages(redis);
    } catch (err) {
      logger.error({ err }, 'Track worker iteration error');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

process.on('SIGTERM', () => { logger.info('Track worker stopping'); process.exit(0); });
process.on('SIGINT', () => { logger.info('Track worker stopping'); process.exit(0); });

start().catch((err) => {
  logger.error({ err }, 'Track worker startup failed');
  process.exit(1);
});

import { Redis } from 'ioredis';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { ensureIndex, percolatePost } from './opensearch.js';
import { insertTrackMatch } from '../db/queries/tracks.js';
import { embedTexts, checkEmbedHealth } from './embedClient.js';

const STREAM_KEY = 'track:posts';
const GROUP_NAME = 'track-workers';
const CONSUMER_NAME = `worker-${process.pid}`;
const BATCH_SIZE = 64;
const BLOCK_MS = 2000;

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

  // 1. Collect all posts from the batch
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
  try {
    embeddings = await embedTexts(posts.map((p) => p.text));
  } catch (err) {
    logger.error({ err, count: posts.length }, 'Batch embedding failed');
    // ACK and skip to avoid blocking the stream
    await redis.xack(STREAM_KEY, GROUP_NAME, ...posts.map((p) => p.messageId), ...ackIds);
    return;
  }

  // 3. Percolate each post with its embedding and store matches
  let totalMatches = 0;
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    try {
      const matchedTrackIds = await percolatePost(post.text, post.did, post.uri, embeddings[i]);
      for (const trackId of matchedTrackIds) {
        await insertTrackMatch(trackId, post.uri, post.did, post.text);
      }
      totalMatches += matchedTrackIds.length;
    } catch (err) {
      logger.error({ err, uri: post.uri }, 'Percolate failed');
    }
  }

  if (totalMatches > 0) {
    logger.info({ posts: posts.length, matches: totalMatches }, 'Batch processed');
  }

  // 4. Bulk ACK
  await redis.xack(STREAM_KEY, GROUP_NAME, ...posts.map((p) => p.messageId), ...ackIds);
}

async function start(): Promise<void> {
  logger.info('Track worker starting');

  // Ensure OpenSearch index exists
  await ensureIndex();

  // Wait for embed service to be ready
  logger.info('Waiting for embed service...');
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    ready = await checkEmbedHealth();
    if (ready) break;
    logger.info({ attempt }, 'Embed service not ready, retrying in 2s...');
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!ready) {
    logger.warn('Embed service not available — starting worker anyway, will fail on embed calls');
  } else {
    logger.info('Embed service ready');
  }

  const redis = new Redis(config.REDIS_URL);
  await ensureConsumerGroup(redis);

  logger.info('Track worker running — consuming from Redis stream with GPU embeddings');

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

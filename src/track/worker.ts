import { Redis } from 'ioredis';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { ensureIndex, percolatePost } from './opensearch.js';
import { insertTrackMatch } from '../db/queries/tracks.js';

const STREAM_KEY = 'track:posts';
const GROUP_NAME = 'track-workers';
const CONSUMER_NAME = `worker-${process.pid}`;
const BATCH_SIZE = 50;
const BLOCK_MS = 5000;

async function ensureConsumerGroup(redis: Redis): Promise<void> {
  try {
    await redis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '0', 'MKSTREAM');
    logger.info('Created consumer group');
  } catch (err: unknown) {
    // Group already exists — fine
    if (err instanceof Error && err.message.includes('BUSYGROUP')) return;
    throw err;
  }
}

async function processMessages(redis: Redis): Promise<void> {
  const results = await redis.xreadgroup(
    'GROUP', GROUP_NAME, CONSUMER_NAME,
    'COUNT', BATCH_SIZE,
    'BLOCK', BLOCK_MS,
    'STREAMS', STREAM_KEY, '>'
  );

  if (!results) return; // timeout, no new messages

  type StreamMessage = [id: string, fields: string[]];
  type StreamResult = [key: string, messages: StreamMessage[]];
  const streams = results as StreamResult[];

  for (const [, messages] of streams) {
    for (const [messageId, fields] of messages) {
      // Parse fields from flat array: ['did', 'xxx', 'text', 'yyy', 'uri', 'zzz', 'ts', '123']
      const data: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        data[fields[i]] = fields[i + 1];
      }

      const { did, text, uri } = data;
      if (!text) {
        await redis.xack(STREAM_KEY, GROUP_NAME, messageId);
        continue;
      }

      try {
        const matchedTrackIds = await percolatePost(text, did, uri);
        for (const trackId of matchedTrackIds) {
          await insertTrackMatch(trackId, uri, did, text);
        }
        if (matchedTrackIds.length > 0) {
          logger.debug({ uri, matches: matchedTrackIds.length }, 'Track matches found');
        }
      } catch (err) {
        logger.error({ err, uri }, 'Percolate failed');
      }

      await redis.xack(STREAM_KEY, GROUP_NAME, messageId);
    }
  }
}

async function start(): Promise<void> {
  logger.info('Track worker starting');

  // Ensure OpenSearch index exists
  await ensureIndex();

  const redis = new Redis(config.REDIS_URL);
  await ensureConsumerGroup(redis);

  logger.info('Track worker running — consuming from Redis stream');

  // Main loop
  while (true) {
    try {
      await processMessages(redis);
    } catch (err) {
      logger.error({ err }, 'Track worker iteration error');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// Graceful shutdown
process.on('SIGTERM', () => { logger.info('Track worker stopping'); process.exit(0); });
process.on('SIGINT', () => { logger.info('Track worker stopping'); process.exit(0); });

start().catch((err) => {
  logger.error({ err }, 'Track worker startup failed');
  process.exit(1);
});

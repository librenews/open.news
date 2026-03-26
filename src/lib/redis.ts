import { Redis } from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    redis.on('error', (err: Error) => logger.error({ err }, 'Redis connection error'));
    redis.on('connect', () => logger.info('Redis connected'));
  }
  return redis;
}

/**
 * Fire-and-forget push to Redis stream.
 * Errors are logged but never thrown — the firehose must not block.
 */
export function xaddPost(did: string, text: string, uri: string, timeUs: string, langs: string, facets = ''): void {
  const r = getRedis();
  r.xadd('track:posts', '*', 'did', did, 'text', text, 'uri', uri, 'ts', timeUs, 'langs', langs, 'facets', facets)
    .catch((err: Error) => logger.warn({ err }, 'Redis XADD failed'));
}

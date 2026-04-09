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
export function xaddPost(did: string, text: string, uri: string, timeUs: string, langs: string, facets = '', embed = ''): void {
  const r = getRedis();
  // Cap the stream at roughly 250,000 posts (~2-3 hours) to prevent infinite memory growth (OOM)
  r.xadd('track:posts', 'MAXLEN', '~', 250000, '*', 'did', did, 'text', text, 'uri', uri, 'ts', timeUs, 'langs', langs, 'facets', facets, 'embed', embed)
    .catch((err: Error) => logger.warn({ err }, 'Redis XADD failed'));
}

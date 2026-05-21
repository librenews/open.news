import { getRedis } from './redis.js';
import { logger } from './logger.js';
import { resolvePds } from './pds.js';
import { BskyAgent } from '@atproto/api';

// ── Key helpers ─────────────────────────────────────────────────────────────

const RECORD_PREFIX = 'pds:rec:';
const PROFILE_PREFIX = 'pds:prof:';
const LIST_PREFIX = 'pds:list:';

function recordKey(did: string, collection: string, rkey: string): string {
  return `${RECORD_PREFIX}${did}:${collection}:${rkey}`;
}

function profileKey(did: string): string {
  return `${PROFILE_PREFIX}${did}`;
}

function listKey(did: string, collection: string): string {
  return `${LIST_PREFIX}${did}:${collection}`;
}

// ── TTL (seconds) ───────────────────────────────────────────────────────────

const TTL_NONE = 0;            // No expiry — invalidated via Jetstream
const TTL_EXTERNAL = 3600;     // 1 hour for records we don't own
const TTL_PROFILE = 86400;     // 24 hours
const TTL_LIST = 300;          // 5 min for listRecords results

// ── Record cache ────────────────────────────────────────────────────────────

/**
 * Get a record from cache, falling back to PDS on miss.
 * Returns the record value (not the envelope), or null if not found anywhere.
 */
export async function getCachedRecord(
  did: string,
  collection: string,
  rkey: string,
  ownerDid?: string // pass the bot DID to get longer TTL for own records
): Promise<any | null> {
  const redis = getRedis();
  const key = recordKey(did, collection, rkey);

  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.warn({ err, key }, 'Redis GET failed, falling through to PDS');
  }

  // Cache miss — fetch from PDS
  try {
    const pdsUrl = await resolvePds(did);
    const agent = new BskyAgent({ service: pdsUrl }) as any;
    const res = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection,
      rkey,
    });
    const record = res.data.value;
    // Warm cache
    const ttl = (ownerDid && did === ownerDid) ? TTL_NONE : TTL_EXTERNAL;
    await warmRecord(did, collection, rkey, record, ttl);
    return record;
  } catch (err) {
    logger.debug({ err, did, collection, rkey }, 'PDS getRecord failed');
    return null;
  }
}

/**
 * Try multiple collections in order, return first hit.
 */
export async function getCachedRecordMulti(
  did: string,
  collections: string[],
  rkey: string,
  ownerDid?: string
): Promise<{ record: any; collection: string } | null> {
  for (const collection of collections) {
    const record = await getCachedRecord(did, collection, rkey, ownerDid);
    if (record) return { record, collection };
  }
  return null;
}

/**
 * Get listRecords result from cache, falling back to PDS on miss.
 */
export async function getCachedListRecords(
  did: string,
  collection: string,
  limit: number = 50,
  ownerDid?: string
): Promise<any[]> {
  const redis = getRedis();
  const key = listKey(did, collection);

  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.warn({ err, key }, 'Redis GET failed for listRecords');
  }

  // Cache miss
  try {
    const pdsUrl = await resolvePds(did);
    const agent = new BskyAgent({ service: pdsUrl }) as any;
    const res = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection,
      limit,
    });
    const records = res.data.records || [];
    await warmListRecords(did, collection, records);
    return records;
  } catch (err) {
    logger.warn({ err, did, collection }, 'PDS listRecords failed');
    return [];
  }
}

// ── Write-through warming ───────────────────────────────────────────────────

/**
 * Warm a single record in cache. Called after putRecord or from Jetstream events.
 */
export async function warmRecord(
  did: string,
  collection: string,
  rkey: string,
  record: any,
  ttl: number = TTL_NONE
): Promise<void> {
  const redis = getRedis();
  const key = recordKey(did, collection, rkey);
  try {
    const json = JSON.stringify(record);
    if (ttl > 0) {
      await redis.set(key, json, 'EX', ttl);
    } else {
      await redis.set(key, json);
    }
  } catch (err) {
    logger.warn({ err, key }, 'Redis SET failed for record warming');
  }
}

/**
 * Warm listRecords cache and also warm each individual record.
 */
export async function warmListRecords(
  did: string,
  collection: string,
  records: any[]
): Promise<void> {
  const redis = getRedis();
  const key = listKey(did, collection);
  try {
    await redis.set(key, JSON.stringify(records), 'EX', TTL_LIST);
    // Also warm individual records
    const pipeline = redis.pipeline();
    for (const r of records) {
      const rkey = r.uri?.split('/').pop();
      if (rkey && r.value) {
        const rKey = recordKey(did, collection, rkey);
        pipeline.set(rKey, JSON.stringify(r.value));
      }
    }
    await pipeline.exec();
  } catch (err) {
    logger.warn({ err, key }, 'Redis failed warming list records');
  }
}

// ── Invalidation ────────────────────────────────────────────────────────────

/**
 * Remove a record from cache. Called on Jetstream delete events.
 */
export async function invalidateRecord(
  did: string,
  collection: string,
  rkey: string
): Promise<void> {
  const redis = getRedis();
  try {
    await redis.del(recordKey(did, collection, rkey));
    // Also invalidate the list cache since it's now stale
    await redis.del(listKey(did, collection));
  } catch (err) {
    logger.warn({ err, did, collection, rkey }, 'Redis DEL failed for invalidation');
  }
}

/**
 * Invalidate listRecords cache for a DID+collection.
 * Call this after any create/update/delete so the list reflects changes.
 */
export async function invalidateList(did: string, collection: string): Promise<void> {
  const redis = getRedis();
  try {
    await redis.del(listKey(did, collection));
  } catch (err) {
    logger.warn({ err }, 'Redis DEL failed for list invalidation');
  }
}

// ── Profile cache ───────────────────────────────────────────────────────────

export interface CachedProfile {
  displayName: string;
  avatar: string;
  handle: string;
  did: string;
}

/**
 * Get a profile from cache, falling back to the public API.
 */
export async function getCachedProfile(did: string): Promise<CachedProfile> {
  const redis = getRedis();
  const key = profileKey(did);

  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    logger.warn({ err, key }, 'Redis GET failed for profile');
  }

  // Fetch from public API
  const profile: CachedProfile = { displayName: did, avatar: '', handle: did, did };
  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
    );
    if (res.ok) {
      const data = await res.json() as any;
      if (data && !data.error) {
        profile.displayName = data.displayName || data.handle || did;
        profile.avatar = data.avatar || '';
        profile.handle = data.handle || did;
      }
    }
  } catch (e) {
    logger.debug({ err: e, did }, 'Profile fetch failed');
  }

  // Cache it
  try {
    await redis.set(key, JSON.stringify(profile), 'EX', TTL_PROFILE);
  } catch (err) {
    logger.warn({ err }, 'Redis SET failed for profile');
  }

  return profile;
}

/**
 * Batch-fetch profiles — uses app.bsky.actor.getProfiles (up to 25 per call).
 * Checks Redis first, only fetches uncached DIDs from the public API,
 * then warms the cache for all resolved profiles.
 * Returns a Map<did, CachedProfile>.
 */
export async function getCachedProfiles(dids: string[]): Promise<Map<string, CachedProfile>> {
  if (dids.length === 0) return new Map();

  const unique = [...new Set(dids)];
  const result = new Map<string, CachedProfile>();
  const uncached: string[] = [];
  const redis = getRedis();

  // 1. Check Redis for all DIDs
  try {
    const pipeline = redis.pipeline();
    for (const did of unique) pipeline.get(profileKey(did));
    const cached = await pipeline.exec();
    for (let i = 0; i < unique.length; i++) {
      const [err, val] = (cached?.[i] || [null, null]) as [Error | null, string | null];
      if (!err && val) {
        try { result.set(unique[i], JSON.parse(val)); continue; } catch {}
      }
      uncached.push(unique[i]);
    }
  } catch {
    uncached.push(...unique.filter(d => !result.has(d)));
  }

  if (uncached.length === 0) return result;

  // 2. Batch-fetch from public API in chunks of 25
  const BATCH = 25;
  for (let i = 0; i < uncached.length; i += BATCH) {
    const chunk = uncached.slice(i, i + BATCH);
    try {
      const params = chunk.map(d => `actors=${encodeURIComponent(d)}`).join('&');
      const res = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?${params}`
      );
      if (res.ok) {
        const data = await res.json() as any;
        const warmPipeline = redis.pipeline();
        for (const p of (data.profiles || [])) {
          const prof: CachedProfile = {
            did: p.did,
            displayName: p.displayName || p.handle || p.did,
            avatar: p.avatar || '',
            handle: p.handle || p.did,
          };
          result.set(p.did, prof);
          warmPipeline.set(profileKey(p.did), JSON.stringify(prof), 'EX', TTL_PROFILE);
        }
        await warmPipeline.exec();
      }
    } catch (err) {
      logger.debug({ err, chunk: chunk.length }, 'Batch profile fetch failed');
    }

    // Fill in any DIDs that weren't in the API response (deleted accounts, etc.)
    for (const did of chunk) {
      if (!result.has(did)) {
        result.set(did, { did, displayName: did, avatar: '', handle: did });
      }
    }
  }

  return result;
}

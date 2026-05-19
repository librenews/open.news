import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';

/**
 * In-memory cache of geotagged DIDs → place_ids.
 * Loaded on startup and refreshed periodically.
 * Allows the firehose handler to check if a DID is geotagged
 * without hitting the DB on every event.
 */
let geotaggedDids: Map<string, { place_id: string; confidence: number }[]> = new Map();
let lastRefresh = 0;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export async function refreshGeotaggedDids(): Promise<void> {
  try {
    const { rows } = await db.query<{ subject: string; place_id: string; confidence: number }>(
      `SELECT subject, place_id, confidence FROM nearby_geotags
       WHERE subject_type = 'account'`
    );

    const map = new Map<string, { place_id: string; confidence: number }[]>();
    for (const row of rows) {
      const existing = map.get(row.subject) || [];
      existing.push({ place_id: row.place_id, confidence: row.confidence });
      map.set(row.subject, existing);
    }

    geotaggedDids = map;
    lastRefresh = Date.now();
    logger.info({ accountCount: map.size }, 'Refreshed geotagged DID cache');
  } catch (err) {
    logger.error({ err }, 'Failed to refresh geotagged DID cache');
  }
}

/**
 * Returns the geo locations for a DID, or null if not geotagged.
 * Triggers a background refresh if the cache is stale.
 */
export function getGeoForDid(did: string): { place_id: string; confidence: number }[] | null {
  // Trigger background refresh if stale
  if (Date.now() - lastRefresh > REFRESH_INTERVAL_MS) {
    refreshGeotaggedDids().catch(() => {});
  }

  return geotaggedDids.get(did) || null;
}

/**
 * Creates geotag records for a post/document from a geotagged account.
 * Uses lower confidence (halved) since this is inherited, not direct.
 * Optionally caches the post text for display.
 */
export async function geotagFromAccount(
  recordUri: string,
  subjectType: 'post' | 'document',
  authorDid: string,
  taggerDid: string,
  postText?: string
): Promise<void> {
  const locations = getGeoForDid(authorDid);
  if (!locations || locations.length === 0) return;

  for (const loc of locations) {
    // Inherited geotags get half the confidence of the account tag
    const inheritedConfidence = Math.round(loc.confidence * 50) / 100;
    
    await db.query(
      `INSERT INTO nearby_geotags (tagger_did, subject, subject_type, place_id, confidence, source)
       VALUES ($1, $2, $3, $4, $5, 'account_inherited')
       ON CONFLICT (subject, place_id, tagger_did) DO NOTHING`,
      [taggerDid, recordUri, subjectType, loc.place_id, inheritedConfidence]
    ).catch(err => {
      logger.debug({ err, recordUri, place_id: loc.place_id }, 'Failed to insert inherited geotag');
    });
  }

  // Cache post text for display
  if (postText && subjectType === 'post') {
    await db.query(
      `INSERT INTO nearby_post_cache (post_uri, post_did, post_text)
       VALUES ($1, $2, $3)
       ON CONFLICT (post_uri) DO NOTHING`,
      [recordUri, authorDid, postText]
    ).catch(() => {});
  }
}

import { db } from '../client.js';

// ─── Track CRUD ─────────────────────────────────────────────────────────────

export interface Track {
  id: bigint;
  user_id: bigint;
  name: string;
  keywords: string[];
  query: string | null;
  threshold: number;
  is_active: boolean;
  notify_via: string;
  os_query_id: string | null;
  feed_token: string;
  uuid: string;
  feed_published: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function createTrack(
  userId: bigint | number,
  name: string,
  keywords: string[],
  osQueryId: string,
  query?: string,
  threshold = 0.75
): Promise<Track> {
  const { rows } = await db.query<Track>(
    `INSERT INTO tracks (user_id, name, keywords, os_query_id, query, threshold)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userId, name, keywords, osQueryId, query ?? null, threshold]
  );
  return rows[0];
}

export async function updateTrack(
  id: bigint | number,
  fields: { name?: string; query?: string; keywords?: string[]; threshold?: number; feed_published?: boolean }
): Promise<Track> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (fields.name !== undefined) { sets.push(`name = $${i++}`); params.push(fields.name); }
  if (fields.query !== undefined) { sets.push(`query = $${i++}`); params.push(fields.query); }
  if (fields.keywords !== undefined) { sets.push(`keywords = $${i++}`); params.push(fields.keywords); }
  if (fields.threshold !== undefined) { sets.push(`threshold = $${i++}`); params.push(fields.threshold); }
  if (fields.feed_published !== undefined) { sets.push(`feed_published = $${i++}`); params.push(fields.feed_published); }
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await db.query<Track>(
    `UPDATE tracks SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params
  );
  return rows[0];
}

export async function getTrackById(id: bigint | number): Promise<Track | null> {
  const { rows } = await db.query<Track>(
    'SELECT * FROM tracks WHERE id = $1', [id]
  );
  return rows[0] ?? null;
}

export async function getTrackByUuid(uuid: string): Promise<Track | null> {
  const { rows } = await db.query<Track>(
    'SELECT * FROM tracks WHERE uuid = $1', [uuid]
  );
  return rows[0] ?? null;
}

export async function getTracksByUserId(userId: bigint | number): Promise<Track[]> {
  const { rows } = await db.query<Track>(
    'SELECT * FROM tracks WHERE user_id = $1 ORDER BY created_at DESC', [userId]
  );
  return rows;
}

export async function getTrackByFeedToken(token: string): Promise<Track | null> {
  const { rows } = await db.query<Track>(
    'SELECT * FROM tracks WHERE feed_token = $1', [token]
  );
  return rows[0] ?? null;
}

export async function getActiveTrackIds(): Promise<number[]> {
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM tracks WHERE is_active = TRUE'
  );
  return rows.map((r) => parseInt(r.id as string, 10));
}

export async function updateTrackKeywords(
  id: bigint | number,
  keywords: string[],
  osQueryId: string
): Promise<void> {
  await db.query(
    `UPDATE tracks SET keywords = $2, os_query_id = $3, updated_at = NOW() WHERE id = $1`,
    [id, keywords, osQueryId]
  );
}

export async function updateTrackQueryEmbedding(
  id: bigint | number,
  queryEmbedding: number[]
): Promise<void> {
  await db.query(
    `UPDATE tracks SET query_embedding = $2, updated_at = NOW() WHERE id = $1`,
    [id, queryEmbedding]
  );
}

export interface TrackWithEmbedding {
  id: number;
  uuid: string;
  threshold: number;
  query_embedding: number[] | null;
}

/** Get all active tracks (with or without embeddings). */
export async function getTracksWithEmbeddings(): Promise<TrackWithEmbedding[]> {
  const { rows } = await db.query<TrackWithEmbedding>(
    `SELECT id, uuid, threshold, query_embedding FROM tracks
     WHERE is_active = TRUE`
  );
  return rows;
}

export async function toggleTrackActive(id: bigint | number): Promise<void> {
  await db.query(
    'UPDATE tracks SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1',
    [id]
  );
}

export async function deleteTrack(id: bigint | number): Promise<void> {
  await db.query('DELETE FROM tracks WHERE id = $1', [id]);
}

// ─── Track Matches ──────────────────────────────────────────────────────────

export interface TrackMatch {
  id: bigint;
  track_id: bigint;
  post_uri: string;
  post_did: string;
  post_text: string;
  matched_at: Date;
  facets: string | null;
  embed: any | null;
}

export async function insertTrackMatch(
  trackId: number,
  postUri: string,
  postDid: string,
  postText: string,
  facetsRaw = '',
  embedRaw = ''
): Promise<void> {
  await db.query(
    `INSERT INTO track_matches (track_id, post_uri, post_did, post_text, facets, embed)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     ON CONFLICT (track_id, post_uri) DO NOTHING`,
    [trackId, postUri, postDid, postText, facetsRaw ? facetsRaw : null, embedRaw ? embedRaw : null]
  );
}

export async function deleteTrackMatchByPostUri(postUri: string): Promise<boolean> {
  const { rows } = await db.query(`DELETE FROM track_matches WHERE post_uri = $1 RETURNING 1`, [postUri]);
  return rows.length > 0;
}

export async function getMatchesByTrackId(
  trackId: bigint | number,
  limit = 50,
  before?: string  // ISO timestamp cursor
): Promise<TrackMatch[]> {
  const params: (bigint | number | string)[] = [trackId, limit];
  let sql = `SELECT * FROM track_matches WHERE track_id = $1 AND matched_at < NOW() - INTERVAL '5 minutes'`;
  if (before) {
    sql += ` AND matched_at < $3`;
    params.push(before);
  }
  sql += ` ORDER BY matched_at DESC LIMIT $2`;
  const { rows } = await db.query<TrackMatch>(sql, params);
  return rows;
}

export async function getMatchesByUserId(
  userId: bigint | number,
  limit = 50,
  before?: string
): Promise<(TrackMatch & { track_name: string; track_uuid: string })[]> {
  const params: (bigint | number | string)[] = [userId, limit];
  let sql = `
    SELECT tm.*, t.name AS track_name, t.uuid AS track_uuid
    FROM track_matches tm
    JOIN tracks t ON t.id = tm.track_id
    WHERE t.user_id = $1 AND tm.matched_at < NOW() - INTERVAL '5 minutes'`;
  if (before) {
    sql += ` AND tm.matched_at < $3`;
    params.push(before);
  }
  sql += ` ORDER BY tm.matched_at DESC LIMIT $2`;
  const { rows } = await db.query<TrackMatch & { track_name: string; track_uuid: string }>(sql, params);
  return rows;
}

export async function getMatchCountByTrack(
  userId: bigint | number
): Promise<{ track_id: string; count: string }[]> {
  const { rows } = await db.query<{ track_id: string; count: string }>(
    `SELECT tm.track_id, COUNT(*) as count
     FROM track_matches tm
     JOIN tracks t ON t.id = tm.track_id
     WHERE t.user_id = $1
     GROUP BY tm.track_id`,
    [userId]
  );
  return rows;
}

export async function getMatchVolumeByTrack(
  trackId: bigint | number,
  range: 'hour' | 'day' | 'week' | 'max'
): Promise<{ label: string; count: number }[]> {
  let trunc = 'hour';
  let interval = '24 hours';
  
  if (range === 'hour') {
    trunc = 'minute';
    interval = '1 hour';
  } else if (range === 'day') {
    trunc = 'hour';
    interval = '24 hours';
  } else if (range === 'week') {
    trunc = 'day';
    interval = '7 days';
  } else if (range === 'max') {
    trunc = 'day';
    interval = '14 days';
  }

  const { rows } = await db.query<{ label: Date; count: string }>(
    `SELECT date_trunc('${trunc}', matched_at) as label, COUNT(*) as count
     FROM track_matches
     WHERE track_id = $1 AND matched_at > NOW() - INTERVAL '${interval}'
     GROUP BY 1
     ORDER BY 1 ASC`,
    [trackId]
  );

  return rows.map(r => ({
    label: new Date(r.label).toISOString(),
    count: parseInt(r.count, 10)
  }));
}

/** Get matches for the Bluesky feed skeleton, ordered by matched_at DESC with cursor pagination. */
export async function getFeedSkeletonMatches(
  userDid: string,
  limit = 30,
  cursor?: string
): Promise<{ post_uri: string; matched_at: string }[]> {
  const params: (string | number)[] = [userDid, limit];
  let sql = `
    SELECT DISTINCT tm.post_uri, tm.matched_at
    FROM track_matches tm
    JOIN tracks t ON t.id = tm.track_id
    JOIN track_users tu ON tu.id = t.user_id
    WHERE tu.did = $1 AND tm.matched_at < NOW() - INTERVAL '5 minutes'`;
  if (cursor) {
    sql += ` AND tm.matched_at < $3`;
    params.push(cursor);
  }
  sql += ` ORDER BY tm.matched_at DESC LIMIT $2`;
  const { rows } = await db.query<{ post_uri: string; matched_at: string }>(sql, params);
  return rows;
}

// ─── System Metrics ─────────────────────────────────────────────────────────

export async function getSystemMetrics(): Promise<{ totalMatches: string; activeTracks: string }> {
  const { rows } = await db.query<{ matches: string; tracks: string }>(`
    SELECT 
      (SELECT COUNT(*) FROM track_matches) as matches,
      (SELECT COUNT(*) FROM tracks WHERE is_active = TRUE) as tracks
  `);
  return {
    totalMatches: rows[0].matches,
    activeTracks: rows[0].tracks
  };
}

// ─── Webhooks ───────────────────────────────────────────────────────────────

export interface TrackWebhook {
  id: bigint;
  uuid: string;
  user_id: bigint;
  url: string;
  secret: string;
  is_active: boolean;
  consecutive_failures: number;
  created_at: Date;
  updated_at: Date;
}

export async function createWebhook(userId: bigint | number, url: string, secret: string, trackIds: (bigint | number)[]): Promise<TrackWebhook> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<TrackWebhook>(
      'INSERT INTO track_webhooks (user_id, url, secret) VALUES ($1, $2, $3) RETURNING *',
      [userId, url, secret]
    );
    const webhook = rows[0];

    for (const trackId of trackIds) {
      await client.query(
        'INSERT INTO track_webhook_subs (webhook_id, track_id) VALUES ($1, $2)',
        [webhook.id, trackId]
      );
    }
    await client.query('COMMIT');
    return webhook;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getWebhooksByUserId(userId: bigint | number): Promise<(TrackWebhook & { track_ids: string[] })[]> {
  const { rows } = await db.query(
    `SELECT w.*, array_agg(ws.track_id) as track_ids
     FROM track_webhooks w
     LEFT JOIN track_webhook_subs ws ON ws.webhook_id = w.id
     WHERE w.user_id = $1
     GROUP BY w.id
     ORDER BY w.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function deleteWebhook(webhookId: bigint | number, userId: bigint | number): Promise<void> {
  await db.query('DELETE FROM track_webhooks WHERE id = $1 AND user_id = $2', [webhookId, userId]);
}

export async function getWebhooksForTracks(trackIds: (bigint | number)[]): Promise<{ track_id: bigint; webhook: TrackWebhook }[]> {
  if (trackIds.length === 0) return [];
  const { rows } = await db.query<{ track_id: bigint; webhook: TrackWebhook }>(
    `SELECT ws.track_id, row_to_json(w.*) as webhook
     FROM track_webhooks w
     JOIN track_webhook_subs ws ON ws.webhook_id = w.id
     WHERE ws.track_id = ANY($1) AND w.is_active = true`,
    [trackIds]
  );
  return rows.map((r) => ({ track_id: r.track_id, webhook: r.webhook as TrackWebhook }));
}

export async function logWebhookFailure(webhookId: bigint | number): Promise<void> {
  await db.query(
    `UPDATE track_webhooks 
     SET consecutive_failures = consecutive_failures + 1,
         is_active = CASE WHEN consecutive_failures + 1 >= 5 THEN false ELSE true END,
         updated_at = NOW()
     WHERE id = $1`,
    [webhookId]
  );
}

export async function logWebhookSuccess(webhookId: bigint | number): Promise<void> {
  await db.query(
    `UPDATE track_webhooks 
     SET consecutive_failures = 0, updated_at = NOW()
     WHERE id = $1`,
    [webhookId]
  );
}


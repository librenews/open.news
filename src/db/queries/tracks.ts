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
  fields: { name?: string; query?: string; keywords?: string[]; threshold?: number }
): Promise<Track> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (fields.name !== undefined) { sets.push(`name = $${i++}`); params.push(fields.name); }
  if (fields.query !== undefined) { sets.push(`query = $${i++}`); params.push(fields.query); }
  if (fields.keywords !== undefined) { sets.push(`keywords = $${i++}`); params.push(fields.keywords); }
  if (fields.threshold !== undefined) { sets.push(`threshold = $${i++}`); params.push(fields.threshold); }
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
  threshold: number;
  query_embedding: number[] | null;
}

/** Get all active tracks (with or without embeddings). */
export async function getTracksWithEmbeddings(): Promise<TrackWithEmbedding[]> {
  const { rows } = await db.query<TrackWithEmbedding>(
    `SELECT id, threshold, query_embedding FROM tracks
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
}

export async function insertTrackMatch(
  trackId: number,
  postUri: string,
  postDid: string,
  postText: string,
  facetsRaw = ''
): Promise<void> {
  const facetsJson = facetsRaw ? JSON.parse(facetsRaw) : null;
  await db.query(
    `INSERT INTO track_matches (track_id, post_uri, post_did, post_text, facets)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (track_id, post_uri) DO NOTHING`,
    [trackId, postUri, postDid, postText, facetsJson]
  );
}

export async function getMatchesByTrackId(
  trackId: bigint | number,
  limit = 50,
  before?: string  // ISO timestamp cursor
): Promise<TrackMatch[]> {
  const params: (bigint | number | string)[] = [trackId, limit];
  let sql = `SELECT * FROM track_matches WHERE track_id = $1`;
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
    WHERE t.user_id = $1`;
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
    WHERE tu.did = $1`;
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

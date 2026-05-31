import { pool } from '../db/client.js';

// ─── Feed Users (same shape as before — OAuth flow uses upsertFeedUser) ─────

export interface FeedUser {
  id: bigint;
  did: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function upsertFeedUser(params: {
  did: string;
  handle: string;
  display_name?: string | null;
  avatar_url?: string | null;
}): Promise<FeedUser> {
  const { rows } = await pool.query<FeedUser>(
    `INSERT INTO feed_users (did, handle, display_name, avatar_url, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (did) DO UPDATE SET
       handle       = EXCLUDED.handle,
       display_name = COALESCE(EXCLUDED.display_name, feed_users.display_name),
       avatar_url   = COALESCE(EXCLUDED.avatar_url, feed_users.avatar_url),
       updated_at   = NOW()
     RETURNING *`,
    [params.did, params.handle, params.display_name ?? null, params.avatar_url ?? null]
  );
  return rows[0]!;
}

export async function getFeedUserById(id: bigint | number): Promise<FeedUser | null> {
  const { rows } = await pool.query<FeedUser>(
    'SELECT * FROM feed_users WHERE id = $1', [id]
  );
  return rows[0] ?? null;
}

export async function getFeedUserByDid(did: string): Promise<FeedUser | null> {
  const { rows } = await pool.query<FeedUser>(
    'SELECT * FROM feed_users WHERE did = $1', [did]
  );
  return rows[0] ?? null;
}

// ─── Custom Feeds ───────────────────────────────────────────────────────────

export interface CustomFeed {
  id: bigint;
  owner_id: bigint | null;
  name: string;
  query: string;
  description: string | null;
  uuid: string;
  bsky_uri: string | null;
  seed_uris: string[];       // JSON array of AT-URIs
  is_public: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function createCustomFeed(params: {
  owner_id?: bigint | number | null;
  name: string;
  query: string;
  description?: string | null;
  seed_uris: string[];
}): Promise<CustomFeed> {
  const { rows } = await pool.query<CustomFeed>(
    `INSERT INTO custom_feeds (owner_id, name, query, description, seed_uris)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      params.owner_id ?? null,
      params.name,
      params.query,
      params.description ?? null,
      JSON.stringify(params.seed_uris),
    ]
  );
  return rows[0]!;
}

export async function getCustomFeedByUuid(uuid: string): Promise<CustomFeed | null> {
  const { rows } = await pool.query<CustomFeed>(
    'SELECT * FROM custom_feeds WHERE uuid = $1', [uuid]
  );
  return rows[0] ?? null;
}

export async function getCustomFeedsByOwner(ownerId: bigint | number): Promise<CustomFeed[]> {
  const { rows } = await pool.query<CustomFeed>(
    'SELECT * FROM custom_feeds WHERE owner_id = $1 ORDER BY created_at DESC', [ownerId]
  );
  return rows;
}

export async function updateCustomFeedBskyUri(id: bigint | number, bskyUri: string): Promise<void> {
  await pool.query(
    'UPDATE custom_feeds SET bsky_uri = $1, is_public = TRUE, updated_at = NOW() WHERE id = $2',
    [bskyUri, id]
  );
}

export async function getCustomFeedMatchUris(uuid: string, limit = 30, cursor?: string): Promise<{ uri: string; matched_at: string }[]> {
  // First try track_matches (populated by the worker via percolate)
  let q = `
    SELECT tm.post_uri AS uri, tm.matched_at::text AS matched_at
    FROM custom_feeds cf
    JOIN tracks t ON t.uuid = cf.uuid
    JOIN track_matches tm ON tm.track_id = t.id
    WHERE cf.uuid = $1
  `;
  const params: unknown[] = [uuid];
  if (cursor) {
    q += ` AND tm.matched_at < $${params.length + 1}`;
    params.push(cursor);
  }
  q += ` ORDER BY tm.matched_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await pool.query<{ uri: string; matched_at: string }>(q, params);
  return rows;
}

export async function deleteCustomFeed(id: bigint | number, uuid: string): Promise<void> {
  // Delete linked track matches + track row
  await pool.query(
    `DELETE FROM track_matches WHERE track_id IN (SELECT id FROM tracks WHERE uuid = $1)`,
    [uuid]
  );
  await pool.query('DELETE FROM tracks WHERE uuid = $1', [uuid]);
  // Delete the custom feed
  await pool.query('DELETE FROM custom_feeds WHERE id = $1', [id]);
}

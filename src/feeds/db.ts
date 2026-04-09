import { pool } from '../db/client.js';

export interface FeedUser {
  id: bigint;
  did: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface FeedColumn {
  id: bigint;
  user_id: bigint;
  feed_type: string;
  feed_uri: string | null;
  title: string;
  position: number;
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

// Column Management
export async function getUserColumns(userId: bigint | number): Promise<FeedColumn[]> {
  const { rows } = await pool.query<FeedColumn>(
    'SELECT * FROM feed_columns WHERE user_id = $1 ORDER BY position ASC, id ASC',
    [userId]
  );
  return rows;
}

export async function getColumnById(id: bigint | number): Promise<FeedColumn | null> {
  const { rows } = await pool.query<FeedColumn>(
    'SELECT * FROM feed_columns WHERE id = $1', [id]
  );
  return rows[0] ?? null;
}

export async function insertColumn(params: {
  user_id: bigint | number;
  feed_type: string;
  feed_uri?: string | null;
  title: string;
  position: number;
}): Promise<FeedColumn> {
  const { rows } = await pool.query<FeedColumn>(
    `INSERT INTO feed_columns (user_id, feed_type, feed_uri, title, position, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
    [params.user_id, params.feed_type, params.feed_uri ?? null, params.title, params.position]
  );
  return rows[0]!;
}

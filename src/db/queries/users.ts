import { db } from '../client.js';

export interface User {
  id: bigint;
  did: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  access_jwt: string | null;
  refresh_jwt: string | null;
  token_expires_at: Date | null;
  follows_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function upsertUser(params: {
  did: string;
  handle: string;
  display_name?: string | null;
  avatar_url?: string | null;
  access_jwt?: string | null;
  refresh_jwt?: string | null;
  token_expires_at?: Date | null;
}): Promise<User> {
  const { rows } = await db.query<User>(
    `INSERT INTO users (did, handle, display_name, avatar_url, access_jwt, refresh_jwt, token_expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (did) DO UPDATE SET
       handle           = EXCLUDED.handle,
       display_name     = COALESCE(EXCLUDED.display_name, users.display_name),
       avatar_url       = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
       access_jwt       = COALESCE(EXCLUDED.access_jwt, users.access_jwt),
       refresh_jwt      = COALESCE(EXCLUDED.refresh_jwt, users.refresh_jwt),
       token_expires_at = COALESCE(EXCLUDED.token_expires_at, users.token_expires_at),
       updated_at       = NOW()
     RETURNING *`,
    [
      params.did,
      params.handle,
      params.display_name ?? null,
      params.avatar_url ?? null,
      params.access_jwt ?? null,
      params.refresh_jwt ?? null,
      params.token_expires_at ?? null,
    ]
  );
  return rows[0]!;
}

export async function getUserById(id: bigint | number): Promise<User | null> {
  const { rows } = await db.query<User>(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function getUserByDid(did: string): Promise<User | null> {
  const { rows } = await db.query<User>(
    'SELECT * FROM users WHERE did = $1',
    [did]
  );
  return rows[0] ?? null;
}

export async function markFollowsSynced(userId: bigint | number): Promise<void> {
  await db.query(
    'UPDATE users SET follows_synced_at = NOW(), updated_at = NOW() WHERE id = $1',
    [userId]
  );
}

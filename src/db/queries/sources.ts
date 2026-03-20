import { db } from '../client.js';

export interface Source {
  id: bigint;
  type: string;
  did: string | null;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  feed_url: string | null;
  last_seen_at: Date | null;
  created_at: Date;
}

export async function upsertSource(params: {
  type?: string;
  did?: string;
  handle?: string;
  display_name?: string | null;
  avatar_url?: string | null;
}): Promise<Source> {
  const type = params.type ?? 'bluesky';
  const { rows } = await db.query<Source>(
    `INSERT INTO sources (type, did, handle, display_name, avatar_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (type, did) DO UPDATE SET
       handle       = COALESCE(EXCLUDED.handle, sources.handle),
       display_name = COALESCE(EXCLUDED.display_name, sources.display_name),
       avatar_url   = COALESCE(EXCLUDED.avatar_url, sources.avatar_url)
     RETURNING *`,
    [type, params.did ?? null, params.handle ?? null, params.display_name ?? null, params.avatar_url ?? null]
  );
  return rows[0]!;
}

export async function linkUserSource(userId: bigint | number, sourceId: bigint | number): Promise<void> {
  await db.query(
    `INSERT INTO user_sources (user_id, source_id) VALUES ($1, $2)
     ON CONFLICT (user_id, source_id) DO NOTHING`,
    [userId, sourceId]
  );
}

export async function getSourceByDid(did: string): Promise<Source | null> {
  const { rows } = await db.query<Source>(
    `SELECT * FROM sources WHERE type = 'bluesky' AND did = $1`,
    [did]
  );
  return rows[0] ?? null;
}

export async function getAllSourceDids(): Promise<string[]> {
  const { rows } = await db.query<{ did: string }>(
    `SELECT DISTINCT did FROM sources WHERE type = 'bluesky' AND did IS NOT NULL`
  );
  return rows.map((r) => r.did);
}

export async function getSourcesForUser(userId: bigint | number): Promise<Source[]> {
  const { rows } = await db.query<Source>(
    `SELECT s.* FROM sources s
     JOIN user_sources us ON us.source_id = s.id
     WHERE us.user_id = $1
     ORDER BY s.display_name, s.handle`,
    [userId]
  );
  return rows;
}

export async function touchSourceLastSeen(did: string): Promise<void> {
  await db.query(
    `UPDATE sources SET last_seen_at = NOW() WHERE did = $1`,
    [did]
  );
}

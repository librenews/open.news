import { db } from '../client.js';

export interface ModerationLog {
  id: bigint;
  did: string;
  uri: string;
  reason: string;
  created_at: Date;
}

export async function logModeration(did: string, uri: string, reason: string): Promise<void> {
  await db.query(`INSERT INTO moderation_logs (did, uri, reason) VALUES ($1, $2, $3)`, [did, uri, reason]);
}

/**
 * Returns a list of URIs that have been caught by the moderation logger within the last 24 hours.
 */
export async function getRecentModeratedUris(reason: string): Promise<string[]> {
  const { rows } = await db.query<{ uri: string }>(
    "SELECT uri FROM moderation_logs WHERE reason = $1 AND created_at >= NOW() - INTERVAL '24 hours'",
    [reason]
  );
  return rows.map((r) => r.uri);
}

/**
 * Cleans up old moderation logs to prevent the database from growing unbounded.
 */
export async function pruneOldModerationLogs(reason: string): Promise<void> {
  await db.query(
    "DELETE FROM moderation_logs WHERE reason = $1 AND created_at < NOW() - INTERVAL '7 days'",
    [reason]
  );
}

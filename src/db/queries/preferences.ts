import { db } from '../client.js';

export interface UserPreference {
  id: bigint;
  user_id: bigint;
  type: string;
  value: string;
  expires_at: Date | null;
  message_id: bigint | null;
  created_at: Date;
}

/** Get all active preferences for a user. */
export async function getUserPreferences(userId: bigint | number): Promise<UserPreference[]> {
  const { rows } = await db.query<UserPreference>(
    `SELECT * FROM user_preferences
     WHERE user_id = $1
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

/** Upsert a preference. */
export async function upsertPreference(
  userId: bigint | number,
  type: string,
  value: string,
  messageId?: bigint | number | null
): Promise<UserPreference> {
  const { rows } = await db.query<UserPreference>(
    `INSERT INTO user_preferences (user_id, type, value, message_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, type, value) DO UPDATE SET
       message_id = COALESCE(EXCLUDED.message_id, user_preferences.message_id),
       expires_at = NULL
     RETURNING *`,
    [userId, type, value, messageId ?? null]
  );
  return rows[0];
}

/** Delete a preference. */
export async function deletePreference(
  userId: bigint | number,
  type: string,
  value: string
): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM user_preferences WHERE user_id = $1 AND type = $2 AND value = $3`,
    [userId, type, value]
  );
  return (rowCount ?? 0) > 0;
}

/** Get muted domains for a user (used by feed + article retrieval). */
export async function getMutedDomains(userId: bigint | number): Promise<string[]> {
  const { rows } = await db.query<{ value: string }>(
    `SELECT value FROM user_preferences
     WHERE user_id = $1 AND type = 'mute_domain'
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId]
  );
  return rows.map(r => r.value);
}

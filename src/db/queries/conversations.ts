import { db } from '../client.js';

export interface Conversation {
  id: bigint;
  visibility: string;
  type: string;
  external_id: string | null;
  title: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Message {
  id: bigint;
  conversation_id: bigint;
  user_id: bigint | null;
  role: string;
  text: string | null;
  blocks: unknown[] | null;
  agent: string | null;
  intent: string | null;
  articles_used: bigint[] | null;
  llm_provider: string | null;
  external_uri: string | null;
  is_complete: boolean;
  created_at: Date;
}

/** Get or create the default private/web conversation for a user. */
export async function getOrCreateDefaultConversation(userId: bigint | number): Promise<Conversation> {
  // Check for existing default conversation
  const { rows: existing } = await db.query<Conversation>(
    `SELECT c.* FROM conversations c
     JOIN conversation_participants cp ON cp.conversation_id = c.id
     WHERE cp.user_id = $1 AND c.type = 'web' AND c.visibility = 'private'
     ORDER BY c.created_at ASC
     LIMIT 1`,
    [userId]
  );
  if (existing[0]) return existing[0];

  // Create new conversation + add user + bot as participants
  const { rows } = await db.query<Conversation>(
    `INSERT INTO conversations (visibility, type) VALUES ('private', 'web') RETURNING *`,
    []
  );
  const convo = rows[0];
  await db.query(
    `INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES ($1, $2, 'member')`,
    [convo.id, userId]
  );
  await db.query(
    `INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES ($1, NULL, 'bot')`,
    [convo.id]
  );
  return convo;
}

/** List conversations for a user, newest activity first. */
export async function getConversationsForUser(userId: bigint | number) {
  const { rows } = await db.query<Conversation & { last_message_at: Date | null }>(
    `SELECT c.*,
            (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_message_at
     FROM conversations c
     JOIN conversation_participants cp ON cp.conversation_id = c.id
     WHERE cp.user_id = $1
     ORDER BY COALESCE(
       (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id),
       c.created_at
     ) DESC`,
    [userId]
  );
  return rows;
}

/** Create a new conversation with the user as participant + bot. */
export async function createConversation(
  userId: bigint | number,
  opts?: { visibility?: string; type?: string; externalId?: string }
): Promise<Conversation> {
  const { rows } = await db.query<Conversation>(
    `INSERT INTO conversations (visibility, type, external_id)
     VALUES ($1, $2, $3) RETURNING *`,
    [opts?.visibility ?? 'private', opts?.type ?? 'web', opts?.externalId ?? null]
  );
  const convo = rows[0];
  await db.query(
    `INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES ($1, $2, 'member')`,
    [convo.id, userId]
  );
  await db.query(
    `INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES ($1, NULL, 'bot')`,
    [convo.id]
  );
  return convo;
}

/** Get paginated messages for a conversation (newest-first, cursor-based). */
export async function getMessages(
  conversationId: bigint | number,
  opts?: { limit?: number; before?: string }
): Promise<Message[]> {
  const limit = Math.min(opts?.limit ?? 50, 100);
  const params: unknown[] = [conversationId, limit + 1];
  let whereExtra = '';

  if (opts?.before) {
    whereExtra = 'AND m.id < $3';
    params.push(opts.before);
  }

  const { rows } = await db.query<Message>(
    `SELECT m.* FROM messages m
     WHERE m.conversation_id = $1 ${whereExtra}
     ORDER BY m.created_at DESC
     LIMIT $2`,
    params
  );
  return rows;
}

/** Insert a new message (user or assistant). */
export async function insertMessage(params: {
  conversationId: bigint | number;
  userId?: bigint | number | null;
  role: string;
  text?: string | null;
  blocks?: unknown[] | null;
  agent?: string | null;
  intent?: string | null;
  articlesUsed?: bigint[] | null;
  llmProvider?: string | null;
  externalUri?: string | null;
  isComplete?: boolean;
}): Promise<Message> {
  const { rows } = await db.query<Message>(
    `INSERT INTO messages
       (conversation_id, user_id, role, text, blocks, agent, intent, articles_used, llm_provider, external_uri, is_complete)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      params.conversationId,
      params.userId ?? null,
      params.role,
      params.text ?? null,
      params.blocks ? JSON.stringify(params.blocks) : null,
      params.agent ?? null,
      params.intent ?? null,
      params.articlesUsed ?? null,
      params.llmProvider ?? null,
      params.externalUri ?? null,
      params.isComplete ?? false,
    ]
  );
  return rows[0];
}

/** Update a message (e.g. finalize after streaming). */
export async function updateMessage(
  id: bigint | number,
  updates: {
    text?: string;
    blocks?: unknown[];
    isComplete?: boolean;
    agent?: string;
    intent?: string;
    articlesUsed?: bigint[];
    llmProvider?: string;
  }
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (updates.text !== undefined) { sets.push(`text = $${i++}`); params.push(updates.text); }
  if (updates.blocks !== undefined) { sets.push(`blocks = $${i++}::jsonb`); params.push(JSON.stringify(updates.blocks)); }
  if (updates.isComplete !== undefined) { sets.push(`is_complete = $${i++}`); params.push(updates.isComplete); }
  if (updates.agent !== undefined) { sets.push(`agent = $${i++}`); params.push(updates.agent); }
  if (updates.intent !== undefined) { sets.push(`intent = $${i++}`); params.push(updates.intent); }
  if (updates.articlesUsed !== undefined) { sets.push(`articles_used = $${i++}`); params.push(updates.articlesUsed); }
  if (updates.llmProvider !== undefined) { sets.push(`llm_provider = $${i++}`); params.push(updates.llmProvider); }

  if (sets.length === 0) return;

  params.push(id);
  await db.query(`UPDATE messages SET ${sets.join(', ')} WHERE id = $${i}`, params);
}

/** Check if a user is a participant of a conversation. */
export async function isParticipant(
  conversationId: bigint | number,
  userId: bigint | number
): Promise<boolean> {
  const { rows } = await db.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM conversation_participants
       WHERE conversation_id = $1 AND user_id = $2
     ) AS exists`,
    [conversationId, userId]
  );
  return rows[0]?.exists ?? false;
}

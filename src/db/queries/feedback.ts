import { db } from '../client.js';

export interface ProductFeedback {
  id: bigint;
  user_id: bigint;
  message_id: bigint | null;
  category: string;
  summary: string;
  raw_text: string;
  status: string;
  admin_notes: string | null;
  created_at: Date;
}

export interface ProductFeedbackWithUser extends ProductFeedback {
  user_handle: string;
  user_display_name: string | null;
}

/** Insert a new product feedback entry. */
export async function insertFeedback(params: {
  userId: bigint | number;
  messageId?: bigint | number;
  category: string;
  summary: string;
  rawText: string;
}): Promise<ProductFeedback> {
  const { rows } = await db.query<ProductFeedback>(
    `INSERT INTO product_feedback (user_id, message_id, category, summary, raw_text)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.userId, params.messageId ?? null, params.category, params.summary, params.rawText]
  );
  return rows[0]!;
}

/** Get all feedback with user info, newest first. Optionally filter by status/category. */
export async function getAllFeedback(filters?: {
  status?: string;
  category?: string;
}): Promise<ProductFeedbackWithUser[]> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (filters?.status) {
    params.push(filters.status);
    conditions.push(`pf.status = $${params.length}`);
  }
  if (filters?.category) {
    params.push(filters.category);
    conditions.push(`pf.category = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await db.query<ProductFeedbackWithUser>(
    `SELECT pf.*, u.handle AS user_handle, u.display_name AS user_display_name
     FROM product_feedback pf
     JOIN users u ON u.id = pf.user_id
     ${where}
     ORDER BY pf.created_at DESC
     LIMIT 100`,
    params
  );
  return rows;
}

/** Get feedback counts grouped by status and category. */
export async function getFeedbackCounts(): Promise<{
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  total: number;
}> {
  const [statusRes, categoryRes] = await Promise.all([
    db.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text as count FROM product_feedback GROUP BY status`
    ),
    db.query<{ category: string; count: string }>(
      `SELECT category, COUNT(*)::text as count FROM product_feedback GROUP BY category`
    ),
  ]);

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of statusRes.rows) {
    byStatus[row.status] = Number(row.count);
    total += Number(row.count);
  }

  const byCategory: Record<string, number> = {};
  for (const row of categoryRes.rows) {
    byCategory[row.category] = Number(row.count);
  }

  return { byStatus, byCategory, total };
}

/** Update feedback status and/or admin notes. */
export async function updateFeedbackStatus(
  id: bigint | number,
  updates: { status?: string; adminNotes?: string }
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];

  if (updates.status) {
    params.push(updates.status);
    sets.push(`status = $${params.length}`);
  }
  if (updates.adminNotes !== undefined) {
    params.push(updates.adminNotes);
    sets.push(`admin_notes = $${params.length}`);
  }

  if (sets.length === 0) return;

  await db.query(
    `UPDATE product_feedback SET ${sets.join(', ')} WHERE id = $1`,
    params
  );
}

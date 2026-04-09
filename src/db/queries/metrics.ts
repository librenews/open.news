import { pool } from '../client.js';
import { logger } from '../../lib/logger.js';

export async function logFeedRequest(
  feedName: string,
  requesterDid?: string,
  cursorUsed?: string,
  limitRequested?: number
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO feed_requests (feed_name, requester_did, cursor_used, limit_requested)
       VALUES ($1, $2, $3, $4)`,
      [feedName, requesterDid || null, cursorUsed || null, limitRequested || null]
    );
  } catch (err) {
    logger.error({ err, feedName, requesterDid }, 'Failed to log feed request to feed_requests table');
  }
}

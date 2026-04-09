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

export async function getFeedMetricsTotals(feedName: string): Promise<{ total: number, uniqueUsers: number }> {
  try {
    const { rows } = await pool.query<{ total: string, unique_users: string }>(
      `SELECT COUNT(*) as total, COUNT(DISTINCT requester_did) as unique_users 
       FROM feed_requests 
       WHERE feed_name = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [feedName]
    );
    return { 
      total: parseInt(rows[0]?.total || '0', 10), 
      uniqueUsers: parseInt(rows[0]?.unique_users || '0', 10) 
    };
  } catch (err) {
    logger.error({ err, feedName }, 'Failed to fetch metric totals');
    return { total: 0, uniqueUsers: 0 };
  }
}

export async function getFeedMetricsChartData(feedName: string): Promise<{ label: string, count: number }[]> {
  try {
    const { rows } = await pool.query<{ hour: Date, count: string }>(
      `SELECT date_trunc('hour', created_at) as hour, COUNT(*) as count 
       FROM feed_requests 
       WHERE feed_name = $1 AND created_at > NOW() - INTERVAL '24 hours'
       GROUP BY 1 
       ORDER BY 1 ASC`,
      [feedName]
    );
    return rows.map(r => ({
      label: new Date(r.hour).toISOString(),
      count: parseInt(r.count, 10)
    }));
  } catch (err) {
    logger.error({ err, feedName }, 'Failed to fetch metric chart data');
    return [];
  }
}

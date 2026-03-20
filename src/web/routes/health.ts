import { Hono } from 'hono';
import { pool } from '../../db/client.js';

export const healthRouter = new Hono();

healthRouter.get('/health', async (c) => {
  let dbStatus = 'ok';
  try {
    await pool.query('SELECT 1');
  } catch {
    dbStatus = 'error';
  }

  return c.json({
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    db: dbStatus,
    uptime: Math.floor(process.uptime()),
  });
});

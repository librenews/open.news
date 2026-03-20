import { Hono } from 'hono';
import { sessionRequired } from '../middleware/session.js';
import { getSourcesForUser } from '../../db/queries/sources.js';
import { getUserById, markFollowsSynced } from '../../db/queries/users.js';
import { logger } from '../../lib/logger.js';

const SYNC_RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour

export const sourcesRouter = new Hono<{
  Variables: { userId: bigint };
}>();

// GET /api/sources
sourcesRouter.get('/api/sources', sessionRequired, async (c) => {
  const userId = c.get('userId');
  const sources = await getSourcesForUser(userId);
  return c.json({ sources });
});

// POST /api/sources/sync
sourcesRouter.post('/api/sources/sync', sessionRequired, async (c) => {
  const userId = c.get('userId');
  const user = await getUserById(userId);

  if (!user) return c.redirect('/login');

  if (user.follows_synced_at) {
    const msSinceSync = Date.now() - user.follows_synced_at.getTime();
    if (msSinceSync < SYNC_RATE_LIMIT_MS) {
      return c.redirect('/feed?notice=sync_rate_limited');
    }
  }

  const { enqueueJob } = await import('../jobEnqueue.js');
  await enqueueJob('syncFollows', { userId: userId.toString(), userDid: user.did });
  logger.info({ userId }, 'Manual follow sync triggered');

  return c.redirect('/feed?notice=sync_queued');
});

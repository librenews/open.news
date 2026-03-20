import { Hono } from 'hono';
import { sessionRequired } from '../middleware/session.js';
import {
  getArticlesForUser,
  markArticleSeen,
  toggleArticleSaved,
} from '../../db/queries/articles.js';

export const articlesRouter = new Hono<{
  Variables: { userId: bigint };
}>();

// GET /api/articles
articlesRouter.get('/api/articles', sessionRequired, async (c) => {
  const userId = c.get('userId');
  const before = c.req.query('before');
  const limit = Number(c.req.query('limit') ?? 20);
  const unreadOnly = c.req.query('unread_only') === 'true';

  const { articles, nextCursor } = await getArticlesForUser(userId, {
    before,
    limit,
    unreadOnly,
  });

  return c.json({ articles, next_cursor: nextCursor });
});

// POST /api/articles/:id/seen
articlesRouter.post('/api/articles/:id/seen', sessionRequired, async (c) => {
  const userId = c.get('userId');
  const articleId = BigInt(c.req.param('id'));
  await markArticleSeen(userId, articleId);
  return c.json({ ok: true });
});

// POST /api/articles/:id/save
articlesRouter.post('/api/articles/:id/save', sessionRequired, async (c) => {
  const userId = c.get('userId');
  const articleId = BigInt(c.req.param('id'));
  await toggleArticleSaved(userId, articleId);
  return c.json({ ok: true });
});

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

// POST /api/articles/:id/like — toggle like
articlesRouter.post('/api/articles/:id/like', async (c) => {
  const userId = c.get('userId' as never) as bigint | undefined;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const articleId = Number(c.req.param('id'));
  const { db } = await import('../../db/client.js');
  
  // Check if already liked
  const { rows } = await db.query(
    'SELECT id FROM news_likes WHERE article_id = $1 AND user_id = $2',
    [articleId, userId]
  );
  
  if (rows.length > 0) {
    // Unlike
    await db.query('DELETE FROM news_likes WHERE article_id = $1 AND user_id = $2', [articleId, userId]);
    const { rows: countRows } = await db.query('SELECT COUNT(*) AS cnt FROM news_likes WHERE article_id = $1', [articleId]);
    return c.json({ liked: false, count: Number(countRows[0].cnt) });
  } else {
    // Like
    await db.query(
      'INSERT INTO news_likes (article_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [articleId, userId]
    );
    const { rows: countRows } = await db.query('SELECT COUNT(*) AS cnt FROM news_likes WHERE article_id = $1', [articleId]);
    return c.json({ liked: true, count: Number(countRows[0].cnt) });
  }
});

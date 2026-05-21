import { Hono } from 'hono';
import { Agent } from '@atproto/api';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { getBlogsSession, getBlogsAuthClient } from './auth.js';

export const blogsInteractRouter = new Hono();

const BLOGS_DOMAIN = process.env.BLOGS_DOMAIN || 'blogs.social';

// ── GET /api/article-stats?uri=at://... ──────────────────────────────────────
blogsInteractRouter.get('/api/article-stats', async (c) => {
  const uri = c.req.query('uri');
  if (!uri) return c.json({ error: 'Missing uri' }, 400);
  const session = await getBlogsSession(c);

  const { rows } = await db.query(
    `SELECT
       COUNT(CASE WHEN interaction_type = 'like' THEN 1 END)::int AS like_count,
       COUNT(CASE WHEN interaction_type IN ('share', 'repost') THEN 1 END)::int AS share_count,
       bool_or(interaction_type = 'like' AND actor_did = $2) AS user_liked
     FROM article_interactions
     WHERE article_uri = $1`,
    [uri, session?.did ?? '']
  );

  const row = rows[0] ?? {};
  return c.json({
    likeCount: row.like_count ?? 0,
    shareCount: row.share_count ?? 0,
    userLiked: row.user_liked === true,
  });
});

// ── POST /api/like  { uri } ───────────────────────────────────────────────────
blogsInteractRouter.post('/api/like', async (c) => {
  const session = await getBlogsSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const { uri } = await c.req.json();
    if (!uri) return c.json({ error: 'Missing uri' }, 400);

    const client = await getBlogsAuthClient();
    const oauthSession = await client.restore(session.did);
    const agent = new Agent(oauthSession);

    const res = await agent.com.atproto.repo.createRecord({
      repo: session.did,
      collection: 'site.standard.graph.recommend',
      record: {
        $type: 'site.standard.graph.recommend',
        document: uri,
        createdAt: new Date().toISOString(),
      },
    });

    await db.query(
      `INSERT INTO article_interactions (article_uri, actor_did, interaction_type, record_uri)
       VALUES ($1, $2, 'like', $3)
       ON CONFLICT (article_uri, actor_did, interaction_type) DO NOTHING`,
      [uri, session.did, res.data.uri]
    );

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count FROM article_interactions WHERE article_uri = $1 AND interaction_type = 'like'`,
      [uri]
    );

    return c.json({ success: true, likeCount: rows[0]?.count ?? 0 });
  } catch (err: any) {
    logger.error({ err }, 'blogs like failed');
    return c.json({ error: err.message }, 500);
  }
});

// ── POST /api/unlike  { uri } ─────────────────────────────────────────────────
blogsInteractRouter.post('/api/unlike', async (c) => {
  const session = await getBlogsSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const { uri } = await c.req.json();
    if (!uri) return c.json({ error: 'Missing uri' }, 400);

    const { rows } = await db.query(
      `SELECT record_uri FROM article_interactions
       WHERE article_uri = $1 AND actor_did = $2 AND interaction_type = 'like' LIMIT 1`,
      [uri, session.did]
    );

    if (rows.length > 0 && rows[0].record_uri) {
      try {
        const client = await getBlogsAuthClient();
        const oauthSession = await client.restore(session.did);
        const agent = new Agent(oauthSession);
        const parts = rows[0].record_uri.replace('at://', '').split('/');
        await agent.com.atproto.repo.deleteRecord({
          repo: parts[0], collection: parts[1], rkey: parts[2],
        });
      } catch (err) {
        logger.warn({ err }, 'PDS recommend delete failed; removing locally only');
      }
    }

    await db.query(
      `DELETE FROM article_interactions WHERE article_uri = $1 AND actor_did = $2 AND interaction_type = 'like'`,
      [uri, session.did]
    );

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*)::int AS count FROM article_interactions WHERE article_uri = $1 AND interaction_type = 'like'`,
      [uri]
    );

    return c.json({ success: true, likeCount: countRows[0]?.count ?? 0 });
  } catch (err: any) {
    logger.error({ err }, 'blogs unlike failed');
    return c.json({ error: err.message }, 500);
  }
});

// ── POST /api/share  { uri } ─────────────────────────────────────────────────
blogsInteractRouter.post('/api/share', async (c) => {
  const session = await getBlogsSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const { uri } = await c.req.json();
    if (!uri) return c.json({ error: 'Missing uri' }, 400);

    const { rows } = await db.query(
      `SELECT title, author_did FROM site_standard_articles WHERE uri = $1 LIMIT 1`,
      [uri]
    );

    const authorDid = uri.replace('at://', '').split('/')[0];
    const rkey = uri.split('/').pop();
    const articleUrl = `https://${BLOGS_DOMAIN}/read/${authorDid}/${rkey}`;
    const title = rows[0]?.title || 'Check out this post on blogs.social';
    const postText = `${title}\n\n${articleUrl}`;

    const encoder = new TextEncoder();
    const byteEnd = encoder.encode(postText).length;
    const byteStart = byteEnd - encoder.encode(articleUrl).length;

    const client = await getBlogsAuthClient();
    const oauthSession = await client.restore(session.did);
    const agent = new Agent(oauthSession);

    const res = await agent.com.atproto.repo.createRecord({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: postText,
        facets: [{ index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: articleUrl }] }],
        createdAt: new Date().toISOString(),
      },
    });

    await db.query(
      `INSERT INTO article_interactions (article_uri, actor_did, interaction_type, record_uri)
       VALUES ($1, $2, 'share', $3)
       ON CONFLICT (article_uri, actor_did, interaction_type) DO NOTHING`,
      [uri, session.did, res.data.uri]
    );

    return c.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, 'blogs share failed');
    return c.json({ error: err.message }, 500);
  }
});

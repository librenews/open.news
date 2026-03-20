/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { sessionRequired } from '../middleware/session.js';
import { db } from '../../db/client.js';
import { getUserById } from '../../db/queries/users.js';
import { AdminPage, type AdminData } from '../views/admin.js';

type AppEnv = { Variables: { userId: bigint } };

export const adminRouter = new Hono<AppEnv>();

// Optional protection: set ADMIN_DID env var to restrict to one account.
// Without it, any logged-in user can view admin (fine for single-user dev).
const ADMIN_DID = (process.env.ADMIN_DID ?? '').trim();

adminRouter.get('/admin', sessionRequired, async (c) => {
  const userId = c.get('userId');
  const user = await getUserById(userId);
  if (!user) return c.redirect('/login');

  // Enforce admin check in production
  if (ADMIN_DID && user.did !== ADMIN_DID) {
    return c.text('Forbidden', 403);
  }

  const [usersRes, articlesRes, sourcesRes, countsRes] = await Promise.all([
    db.query<{ id: string; handle: string; created_at: string }>(`
      SELECT id::text, handle, created_at
      FROM users ORDER BY created_at DESC LIMIT 20
    `),
    db.query<{ id: string; title: string | null; url: string; is_news: boolean; fetch_status: string; created_at: string }>(`
      SELECT id::text, title, url, is_news, fetch_status, created_at
      FROM articles ORDER BY created_at DESC LIMIT 30
    `),
    db.query<{ id: string; handle: string | null; display_name: string | null; type: string; created_at: string }>(`
      SELECT id::text, handle, display_name, type, created_at
      FROM sources ORDER BY created_at DESC LIMIT 20
    `),
    db.query<{ users: string; articles: string; sources: string; news: string }>(`
      SELECT
        (SELECT COUNT(*) FROM users)::text AS users,
        (SELECT COUNT(*) FROM articles)::text AS articles,
        (SELECT COUNT(*) FROM sources)::text AS sources,
        (SELECT COUNT(*) FROM articles WHERE is_news = true)::text AS news
    `),
  ]);

  const counts = countsRes.rows[0];
  const data: AdminData = {
    users: usersRes.rows,
    articles: articlesRes.rows,
    sources: sourcesRes.rows,
    counts: {
      users: Number(counts.users),
      articles: Number(counts.articles),
      sources: Number(counts.sources),
      news: Number(counts.news),
    },
  };

  return c.html((<AdminPage data={data} user={user} />) as unknown as string);
});

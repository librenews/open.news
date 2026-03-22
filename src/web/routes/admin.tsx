/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { sessionRequired } from '../middleware/session.js';
import { db } from '../../db/client.js';
import { getUserById } from '../../db/queries/users.js';
import { getAllFeedback, getFeedbackCounts, updateFeedbackStatus } from '../../db/queries/feedback.js';
import { AdminPage, type AdminData } from '../views/admin.js';
import { AdminProductPage } from '../views/adminProduct.js';

type AppEnv = { Variables: { userId: bigint } };

export const adminRouter = new Hono<AppEnv>();

// ADMIN_HANDLES env var: comma-separated list of Bluesky handles with admin access.
// Example: ADMIN_HANDLES=librenews.bsky.social,other.bsky.social
const ADMIN_HANDLES = (process.env.ADMIN_HANDLES ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

async function isAdmin(userId: bigint): Promise<{ ok: boolean; user: { handle: string } | null }> {
  const user = await getUserById(userId);
  if (!user) return { ok: false, user: null };
  if (ADMIN_HANDLES.length === 0) return { ok: true, user }; // No restriction in dev
  if (ADMIN_HANDLES.includes(user.handle.toLowerCase())) return { ok: true, user };
  return { ok: false, user };
}

adminRouter.get('/admin', sessionRequired, async (c) => {
  const userId = c.get('userId');
  const { ok, user } = await isAdmin(userId);
  if (!user) return c.redirect('/login');
  if (!ok) return c.text('Forbidden', 403);

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

// ─── Product Feedback Dashboard ──────────────────────────────────────────────

adminRouter.get('/admin/product', sessionRequired, async (c) => {
  const userId = c.get('userId');
  const { ok, user } = await isAdmin(userId);
  if (!user) return c.redirect('/login');
  if (!ok) return c.text('Forbidden', 403);

  const status = c.req.query('status') || undefined;
  const category = c.req.query('category') || undefined;

  const [feedback, counts] = await Promise.all([
    getAllFeedback({ status, category }),
    getFeedbackCounts(),
  ]);

  const feedbackSerialized = feedback.map((f) => ({
    ...f,
    id: String(f.id),
    created_at: f.created_at instanceof Date ? f.created_at.toISOString() : String(f.created_at),
  }));

  return c.html((
    <AdminProductPage feedback={feedbackSerialized} counts={counts} user={user} filter={{ status, category }} />
  ) as unknown as string);
});

adminRouter.post('/admin/product/:id', sessionRequired, async (c) => {
  const userId = c.get('userId');
  const { ok } = await isAdmin(userId);
  if (!ok) return c.text('Forbidden', 403);

  const feedbackId = Number(c.req.param('id'));
  const body = await c.req.parseBody();
  const status = body.status as string | undefined;
  const adminNotes = body.admin_notes as string | undefined;

  await updateFeedbackStatus(feedbackId, { status, adminNotes });

  return c.redirect('/admin/product');
});

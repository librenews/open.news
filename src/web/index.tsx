import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';

import { sessionMiddleware, sessionRequired, clearSessionCookie } from './middleware/session.js';
import { rateLimit } from './middleware/rateLimit.js';
import { authRouter } from './routes/auth.js';
import { articlesRouter } from './routes/articles.js';
import { sourcesRouter } from './routes/sources.js';
import { healthRouter } from './routes/health.js';
import { adminRouter } from './routes/admin.js';
import { runMigrations } from '../db/migrate.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { getUserById } from '../db/queries/users.js';
import { getArticlesForUser } from '../db/queries/articles.js';
import { LoginPage } from './views/login.js';
import { FeedPage } from './views/feed.js';

const app = new Hono();

// Middleware
app.use('*', rateLimit);
app.use('*', sessionMiddleware);

// Static assets
app.use('/static/*', serveStatic({ root: './public' }));

// Routes
app.route('/', authRouter);
app.route('/', articlesRouter);
app.route('/', sourcesRouter);
app.route('/', healthRouter);
app.route('/', adminRouter);

// ─── Page Routes ────────────────────────────────────────────────────────────

// GET / → redirect to feed or login
app.get('/', (c) => {
  const userId = c.get('userId' as never) as bigint | undefined;
  return c.redirect(userId ? '/feed' : '/login');
});

// GET /login
app.get('/login', (c) => {
  const userId = c.get('userId' as never) as bigint | undefined;
  if (userId) return c.redirect('/feed');
  return c.html((<LoginPage />) as unknown as string);
});

// GET /feed
app.get('/feed', sessionRequired, async (c) => {
  const userId = c.get('userId');
  const before = c.req.query('before');
  const notice = c.req.query('notice') ?? null;

  const [user, feedResult] = await Promise.all([
    getUserById(userId),
    getArticlesForUser(userId, { before }),
  ]);

  if (!user) return c.redirect('/login');

  const { articles, nextCursor } = feedResult;

  // Serialize BigInt fields as strings/numbers for the view
  const serialized = articles.map((a) => ({
    ...a,
    id: Number(a.id),
    published_at: a.published_at?.toISOString() ?? null,
    seen_at: a.seen_at?.toISOString() ?? null,
    saved_at: a.saved_at?.toISOString() ?? null,
    created_at: a.created_at.toISOString(),
    updated_at: a.updated_at.toISOString(),
    fetched_at: a.fetched_at?.toISOString() ?? null,
    text_extracted_at: a.text_extracted_at?.toISOString() ?? null,
  }));

  return c.html(
    (<FeedPage articles={serialized as never} user={user} nextCursor={nextCursor} notice={notice} />) as unknown as string
  );
});

// POST /logout
app.post('/logout', (c) => {
  clearSessionCookie(c);
  return c.redirect('/login');
});

// ─── Startup ─────────────────────────────────────────────────────────────────

async function start() {
  await runMigrations();
  logger.info('Migrations complete');

  // Stale OAuth sessions can throw unhandled TokenRefreshErrors on startup —
  // log them instead of crashing.
  process.on('unhandledRejection', (reason) => {
    logger.warn({ reason }, 'Unhandled promise rejection (non-fatal)');
  });

  serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    logger.info({ port: info.port }, 'Web server started');
  });
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start web server');
  process.exit(1);
});

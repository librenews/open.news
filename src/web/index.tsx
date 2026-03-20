import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';

import { sessionMiddleware, sessionRequired, clearSessionCookie } from './middleware/session.js';
import { rateLimit } from './middleware/rateLimit.js';
import { authRouter } from './routes/auth.js';
import { articlesRouter } from './routes/articles.js';
import { sourcesRouter } from './routes/sources.js';
import { healthRouter } from './routes/health.js';
import { adminRouter } from './routes/admin.js';
import conversationsRouter from './routes/conversations.js';
import { runMigrations } from '../db/migrate.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { getUserById } from '../db/queries/users.js';
import { getArticlesForUser } from '../db/queries/articles.js';
import { getOrCreateDefaultConversation, getMessages } from '../db/queries/conversations.js';
import { sseRegistry } from './sseRegistry.js';
import { LoginPage } from './views/login.js';
import { FeedPage } from './views/feed.js';
import { ChatPage } from './views/chat.js';
import { Layout } from './views/layout.js';

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
app.route('/api/conversations', conversationsRouter);

// ─── SSE Stream ──────────────────────────────────────────────────────────────

app.get('/api/stream', sessionRequired, (c) => {
  const userId = c.get('userId') as unknown as number;
  return streamSSE(c, async (stream) => {
    sseRegistry.add(userId, stream);
    const ping = setInterval(() => {
      stream.writeSSE({ event: 'ping', data: '' }).catch(() => {});
    }, 30_000);
    stream.onAbort(() => {
      clearInterval(ping);
      sseRegistry.remove(userId, stream);
    });
    // Hold open indefinitely
    await new Promise(() => {});
  });
});

// ─── Page Routes ────────────────────────────────────────────────────────────

// GET / → redirect to chat or login
app.get('/', (c) => {
  const userId = c.get('userId' as never) as bigint | undefined;
  return c.redirect(userId ? '/chat' : '/login');
});

// GET /login
app.get('/login', (c) => {
  const userId = c.get('userId' as never) as bigint | undefined;
  if (userId) return c.redirect('/chat');
  return c.html((<LoginPage />) as unknown as string);
});

// GET /chat — load or create default conversation
app.get('/chat', sessionRequired, async (c) => {
  const userId = c.get('userId');
  const user = await getUserById(userId);
  if (!user) return c.redirect('/login');

  const conversation = await getOrCreateDefaultConversation(userId);
  const messages = (await getMessages(conversation.id, { limit: 50 })).reverse();

  return c.html(
    (<Layout title="Chat" user={user}>
      <ChatPage user={user} conversation={{ id: Number(conversation.id) }} messages={messages} />
    </Layout>) as unknown as string
  );
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

  const serialized = articles.map((a) => ({
    ...a,
    id: Number(a.id),
    fetch_status: a.fetch_status,
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

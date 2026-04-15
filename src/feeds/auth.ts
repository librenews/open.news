import { Hono } from 'hono';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { pool } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { upsertFeedUser, getFeedUserById, FeedUser } from './db.js';

const FEEDS_BASE_URL = process.env.FEEDS_BASE_URL ?? 'http://localhost:3000';
const FEEDS_OAUTH_CLIENT_ID = process.env.FEEDS_OAUTH_CLIENT_ID ?? `${FEEDS_BASE_URL}/client-metadata.json`;

// Simple in-memory lock
const locks = new Map<string, Promise<unknown>>();
function requestLock<T>(key: string, fn: () => T | PromiseLike<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(() => fn()) as Promise<T>;
  locks.set(key, next.catch(() => {}));
  next.finally(() => { if (locks.get(key) === next) locks.delete(key); });
  return next;
}

let _oauthClient: NodeOAuthClient | null = null;

export async function getOAuthClient(): Promise<NodeOAuthClient> {
  if (_oauthClient) return _oauthClient;

  _oauthClient = new NodeOAuthClient({
    clientMetadata: {
      client_id: FEEDS_OAUTH_CLIENT_ID,
      client_name: 'Feeds',
      client_uri: FEEDS_BASE_URL,
      redirect_uris: [`${FEEDS_BASE_URL}/oauth/callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'atproto transition:generic',
      dpop_bound_access_tokens: true,
    },
    requestLock,
    stateStore: {
      async set(key: string, value: Record<string, unknown>) {
        await pool.query(
          `INSERT INTO feed_oauth_state (key, value, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
           ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = NOW() + INTERVAL '10 minutes'`,
          [key, JSON.stringify(value)]
        );
      },
      async get(key: string) {
        const { rows } = await pool.query<{ value: string }>(
          `SELECT value FROM feed_oauth_state WHERE key = $1 AND expires_at > NOW()`,
          [key]
        );
        return rows[0] ? JSON.parse(rows[0].value) : undefined;
      },
      async del(key: string) {
        await pool.query('DELETE FROM feed_oauth_state WHERE key = $1', [key]);
      },
    },
    sessionStore: {
      async set(sub: string, value: Record<string, unknown>) {
        await pool.query(
          `INSERT INTO feed_oauth_sessions (sub, value) VALUES ($1, $2)
           ON CONFLICT (sub) DO UPDATE SET value = $2, updated_at = NOW()`,
          [sub, JSON.stringify(value)]
        );
      },
      async get(sub: string) {
        const { rows } = await pool.query<{ value: string }>(
          'SELECT value FROM feed_oauth_sessions WHERE sub = $1',
          [sub]
        );
        return rows[0] ? JSON.parse(rows[0].value) : undefined;
      },
      async del(sub: string) {
        await pool.query('DELETE FROM feed_oauth_sessions WHERE sub = $1', [sub]);
      },
    },
  });

  process.on('unhandledRejection', (err: unknown) => {
    if (err instanceof Error && err.constructor.name === 'TokenRefreshError') {
      logger.warn({ err: err.message }, 'Feeds OAuth token refresh failed (non-fatal)');
      return;
    }
    throw err;
  });

  return _oauthClient;
}

export async function getAgent(did: string) {
  const client = await getOAuthClient();
  return client.restore(did);
}

export const feedsAuthRouter = new Hono();

// Client metadata endpoint
feedsAuthRouter.get('/client-metadata.json', async (c) => {
  const client = await getOAuthClient();
  return c.json(client.clientMetadata!);
});

// Login page
feedsAuthRouter.get('/login', async (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        for(let reg of regs) reg.unregister();
      });
    }
  </script>
  <title>feeds.social — Minimalist Bluesky Client</title>
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
</head>
<body class="bg-white font-[Inter] text-slate-800 min-h-screen flex flex-col items-center justify-center px-4">
  <div class="w-full max-w-sm flex flex-col items-center">
    <h1 class="text-3xl font-bold mb-2">feeds.social</h1>
    <p class="text-slate-500 text-sm mb-8 text-center">A multi-column feed reader for Bluesky.</p>
    <form action="/oauth/login" method="GET" class="w-full space-y-4">
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Bluesky Handle</label>
        <input type="text" name="handle" placeholder="yourname.bsky.social" required autofocus
          class="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder:text-slate-300">
      </div>
      <button type="submit"
        class="w-full py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-medium rounded-lg text-sm hover:from-blue-600 hover:to-indigo-600 transition-all shadow-sm cursor-pointer">
        Sign in with Bluesky
      </button>
    </form>
    <div class="mt-8 text-center flex flex-col items-center">
      <p class="text-xs text-slate-400">Powered by the AT Protocol</p>
    </div>
  </div>
</body>
</html>`);
});

// Start OAuth flow
feedsAuthRouter.get('/oauth/login', async (c) => {
  const handle = c.req.query('handle')?.trim();
  if (!handle) {
    return c.html('<p>Handle required. <a href="/login">Back</a></p>', 400);
  }

  try {
    const client = await getOAuthClient();
    const url = await client.authorize(handle, { scope: client.clientMetadata?.scope || 'atproto transition:generic' });
    return c.redirect(url.toString());
  } catch (err) {
    logger.error({ err, handle }, 'Feeds OAuth initiation failed');
    return c.html('<p>Failed to start login. <a href="/login">Try again</a></p>', 500);
  }
});

// OAuth callback
feedsAuthRouter.get('/oauth/callback', async (c) => {
  const params = c.req.query();

  try {
    const client = await getOAuthClient();
    const { session } = await client.callback(new URLSearchParams(params));

    const did = session.did;

    let handle: string = did;
    let displayName: string | null = null;
    let avatarUrl: string | null = null;
    try {
      const profileUrl = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`;
      const profileRes = await fetch(profileUrl);
      if (profileRes.ok) {
        const p = await profileRes.json() as { handle?: string; displayName?: string; avatar?: string };
        handle = p.handle ?? did;
        displayName = p.displayName ?? null;
        avatarUrl = p.avatar ?? null;
      }
    } catch (profileErr) {
      logger.warn({ profileErr, did }, 'Could not fetch profile');
    }

    const user = await upsertFeedUser({ did, handle, display_name: displayName, avatar_url: avatarUrl });

    // Set Feeds session cookie
    const { createHmac } = await import('crypto');
    const secret = process.env.SESSION_SECRET ?? 'dev-secret';
    const payload = String(user.id);
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    const { setCookie } = await import('hono/cookie');
    setCookie(c, 'feeds_session', `${payload}.${sig}`, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: FEEDS_BASE_URL.startsWith('https://'),
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    });

    logger.info({ did, handle, userId: user.id }, 'Feeds user logged in');
    return c.redirect('/');
  } catch (err) {
    logger.error({ err }, 'Feeds OAuth callback failed');
    return c.html('<p>Login failed. <a href="/login">Try again</a></p>', 500);
  }
});

// Logout
feedsAuthRouter.post('/oauth/logout', async (c) => {
  const { deleteCookie } = await import('hono/cookie');
  deleteCookie(c, 'feeds_session', { path: '/' });
  return c.redirect('/login');
});

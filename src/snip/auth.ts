import { Hono } from 'hono';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createHmac } from 'crypto';
import { getCachedProfile } from '../lib/pdsCache.js';

const SNIP_BASE_URL = process.env.SNIP_BASE_URL ?? 'http://localhost:5100';
const SNIP_OAUTH_CLIENT_ID = process.env.SNIP_OAUTH_CLIENT_ID ?? `${SNIP_BASE_URL}/client-metadata.json`;

// Simple in-memory lock
const locks = new Map<string, Promise<unknown>>();
function requestLock<T>(key: string, fn: () => T | PromiseLike<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(() => fn()) as Promise<T>;
  locks.set(key, next.catch(() => {}));
  next.finally(() => { if (locks.get(key) === next) locks.delete(key); });
  return next;
}

export interface SnipUser {
  id: number;
  did: string;
  handle: string;
}

export async function upsertSnipUser({ did, handle }: { did: string; handle: string }): Promise<SnipUser> {
  const { rows } = await db.query<SnipUser>(
    `INSERT INTO snip_users (did, handle, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (did) DO UPDATE SET handle = EXCLUDED.handle, updated_at = NOW()
     RETURNING id, did, handle`,
    [did, handle]
  );
  return rows[0];
}

export async function getSnipUserById(id: number): Promise<SnipUser | null> {
  const { rows } = await db.query<SnipUser>(
    'SELECT id, did, handle FROM snip_users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

let _oauthClient: NodeOAuthClient | null = null;

export async function getOAuthClient(): Promise<NodeOAuthClient> {
  if (_oauthClient) return _oauthClient;

  _oauthClient = new NodeOAuthClient({
    clientMetadata: {
      client_id: SNIP_OAUTH_CLIENT_ID,
      client_name: 'Snip.social',
      client_uri: SNIP_BASE_URL,
      redirect_uris: [`${SNIP_BASE_URL}/oauth/callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'atproto transition:generic repo:app.bsky.feed.generator?action=create',
      dpop_bound_access_tokens: true,
    },
    requestLock,
    stateStore: {
      async set(key: string, value: Record<string, unknown>) {
        await db.query(
          `INSERT INTO snip_oauth_state (key, value, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
           ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = NOW() + INTERVAL '10 minutes'`,
          [key, JSON.stringify(value)]
        );
      },
      async get(key: string) {
        const { rows } = await db.query<{ value: string }>(
          `SELECT value FROM snip_oauth_state WHERE key = $1 AND expires_at > NOW()`,
          [key]
        );
        return rows[0] ? JSON.parse(rows[0].value) : undefined;
      },
      async del(key: string) {
        await db.query('DELETE FROM snip_oauth_state WHERE key = $1', [key]);
      },
    },
    sessionStore: {
      async set(sub: string, value: Record<string, unknown>) {
        await db.query(
          `INSERT INTO snip_oauth_sessions (sub, value) VALUES ($1, $2)
           ON CONFLICT (sub) DO UPDATE SET value = $2, updated_at = NOW()`,
          [sub, JSON.stringify(value)]
        );
      },
      async get(sub: string) {
        const { rows } = await db.query<{ value: string }>(
          'SELECT value FROM snip_oauth_sessions WHERE sub = $1',
          [sub]
        );
        return rows[0] ? JSON.parse(rows[0].value) : undefined;
      },
      async del(sub: string) {
        await db.query('DELETE FROM snip_oauth_sessions WHERE sub = $1', [sub]);
      },
    },
  });

  process.on('unhandledRejection', (err: unknown) => {
    if (err instanceof Error && err.constructor.name === 'TokenRefreshError') {
      logger.warn({ err: err.message }, 'Snip OAuth token refresh failed (non-fatal)');
      return;
    }
    throw err;
  });

  return _oauthClient;
}

export async function getSessionUser(c: any) {
  const cookie = getCookie(c, 'snip_session');
  if (!cookie) return null;

  const [payload, sig] = cookie.split('.');
  if (!payload || !sig) return null;

  const secret = process.env.SESSION_SECRET ?? 'dev-secret';
  const expectedSig = createHmac('sha256', secret).update(payload).digest('hex');
  if (sig !== expectedSig) return null;

  const userId = parseInt(payload, 10);
  const user = await getSnipUserById(userId);
  if (!user) return null;

  const p = await getCachedProfile(user.did);
  return {
    did: user.did,
    handle: user.handle,
    avatar: p?.avatar || undefined,
    displayName: p?.displayName || undefined
  };
}

export const snipAuthRouter = new Hono();

// Client Metadata Endpoint
snipAuthRouter.get('/client-metadata.json', async (c) => {
  const client = await getOAuthClient();
  return c.json(client.clientMetadata!);
});

// Login Page UI
snipAuthRouter.get('/login', async (c) => {
  const user = await getSessionUser(c);
  if (user) return c.redirect('/');

  return c.html(`<!DOCTYPE html>
<html lang="en" class="h-full bg-slate-950">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in to Snip</title>
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: #020617;
      color: #f8fafc;
    }
    .title-font {
      font-family: 'Outfit', sans-serif;
    }
  </style>
</head>
<body class="min-h-full flex items-center justify-center p-6">
  <div class="w-full max-w-sm bg-slate-900/40 border border-slate-800/80 rounded-3xl p-8 shadow-2xl relative">
    <div class="text-center mb-8">
      <a href="/" class="title-font text-3xl font-black bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent no-underline">
        snip.
      </a>
      <p class="text-xs text-slate-500 mt-2">Sign in to publish search feeds to your Bluesky profile.</p>
    </div>

    <form action="/oauth/login" method="GET" class="space-y-4">
      <div>
        <label class="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Bluesky Handle</label>
        <input 
          type="text" 
          name="handle" 
          placeholder="yourname.bsky.social" 
          required 
          autofocus
          class="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder:text-slate-650 focus:outline-none focus:border-indigo-500/50"
        />
      </div>
      <button 
        type="submit"
        class="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm transition-all shadow-lg shadow-indigo-600/10 cursor-pointer"
      >
        Sign in with Bluesky
      </button>
    </form>
    
    <div class="mt-8 text-center text-[10px] text-slate-600">
      Powered by the AT Protocol
    </div>
  </div>
</body>
</html>`);
});

// GET /oauth/login
snipAuthRouter.get('/oauth/login', async (c) => {
  const handle = c.req.query('handle')?.trim();
  if (!handle) {
    return c.html('<p>Handle required. <a href="/login">Back</a></p>', 400);
  }

  try {
    const client = await getOAuthClient();
    const url = await client.authorize(handle, { scope: client.clientMetadata?.scope || 'atproto transition:generic' });
    return c.redirect(url.toString());
  } catch (err) {
    logger.error({ err, handle }, 'Snip OAuth initiation failed');
    return c.html('<p>Failed to start login. <a href="/login">Try again</a></p>', 500);
  }
});

// GET /oauth/callback
snipAuthRouter.get('/oauth/callback', async (c) => {
  const params = c.req.query();

  try {
    const client = await getOAuthClient();
    const { session } = await client.callback(new URLSearchParams(params));

    const did = session.did;
    let handle = did;

    try {
      const profileUrl = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`;
      const profileRes = await fetch(profileUrl);
      if (profileRes.ok) {
        const p = await profileRes.json() as { handle?: string };
        handle = p.handle ?? did;
      }
    } catch (profileErr) {
      logger.warn({ profileErr, did }, 'Could not fetch profile for oauth user');
    }

    const user = await upsertSnipUser({ did, handle });

    // Set Session Cookie
    const secret = process.env.SESSION_SECRET ?? 'dev-secret';
    const payload = String(user.id);
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    
    setCookie(c, 'snip_session', `${payload}.${sig}`, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: SNIP_BASE_URL.startsWith('https://'),
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    });

    logger.info({ did, handle, userId: user.id }, 'Snip user logged in');
    return c.redirect('/');
  } catch (err) {
    logger.error({ err }, 'Snip OAuth callback failed');
    return c.html('<p>Login failed. <a href="/login">Try again</a></p>', 500);
  }
});

// POST /oauth/logout
snipAuthRouter.post('/oauth/logout', async (c) => {
  deleteCookie(c, 'snip_session', { path: '/' });
  return c.redirect('/');
});

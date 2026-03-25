import { Hono } from 'hono';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { pool } from '../db/client.js';
import { logger } from '../lib/logger.js';

const TRACK_BASE_URL = process.env.TRACK_BASE_URL ?? 'http://localhost:4200';
const TRACK_OAUTH_CLIENT_ID = process.env.TRACK_OAUTH_CLIENT_ID ?? `${TRACK_BASE_URL}/client-metadata.json`;

// Simple in-memory lock
const locks = new Map<string, Promise<unknown>>();
function requestLock<T>(key: string, fn: () => T | PromiseLike<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(() => fn()) as Promise<T>;
  locks.set(key, next.catch(() => {}));
  next.finally(() => { if (locks.get(key) === next) locks.delete(key); });
  return next;
}

export interface TrackUser {
  id: bigint;
  did: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}

let _oauthClient: NodeOAuthClient | null = null;

async function getOAuthClient(): Promise<NodeOAuthClient> {
  if (_oauthClient) return _oauthClient;

  _oauthClient = new NodeOAuthClient({
    clientMetadata: {
      client_id: TRACK_OAUTH_CLIENT_ID,
      client_name: 'Track',
      client_uri: TRACK_BASE_URL,
      redirect_uris: [`${TRACK_BASE_URL}/oauth/callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'atproto',
      dpop_bound_access_tokens: true,
    },
    requestLock,
    stateStore: {
      async set(key: string, value: Record<string, unknown>) {
        await pool.query(
          `INSERT INTO track_oauth_state (key, value, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
           ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = NOW() + INTERVAL '10 minutes'`,
          [key, JSON.stringify(value)]
        );
      },
      async get(key: string) {
        const { rows } = await pool.query<{ value: string }>(
          `SELECT value FROM track_oauth_state WHERE key = $1 AND expires_at > NOW()`,
          [key]
        );
        return rows[0] ? JSON.parse(rows[0].value) : undefined;
      },
      async del(key: string) {
        await pool.query('DELETE FROM track_oauth_state WHERE key = $1', [key]);
      },
    },
    sessionStore: {
      async set(sub: string, value: Record<string, unknown>) {
        await pool.query(
          `INSERT INTO track_oauth_sessions (sub, value) VALUES ($1, $2)
           ON CONFLICT (sub) DO UPDATE SET value = $2, updated_at = NOW()`,
          [sub, JSON.stringify(value)]
        );
      },
      async get(sub: string) {
        const { rows } = await pool.query<{ value: string }>(
          'SELECT value FROM track_oauth_sessions WHERE sub = $1',
          [sub]
        );
        return rows[0] ? JSON.parse(rows[0].value) : undefined;
      },
      async del(sub: string) {
        await pool.query('DELETE FROM track_oauth_sessions WHERE sub = $1', [sub]);
      },
    },
  });

  // Prevent unhandled TokenRefreshError from crashing the process
  process.on('unhandledRejection', (err: unknown) => {
    if (err instanceof Error && err.constructor.name === 'TokenRefreshError') {
      logger.warn({ err: err.message }, 'Track OAuth token refresh failed (non-fatal)');
      return;
    }
    throw err;  // re-throw everything else
  });

  return _oauthClient;
}

async function upsertTrackUser(params: {
  did: string;
  handle: string;
  display_name?: string | null;
  avatar_url?: string | null;
}): Promise<TrackUser> {
  const { rows } = await pool.query<TrackUser>(
    `INSERT INTO track_users (did, handle, display_name, avatar_url, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (did) DO UPDATE SET
       handle       = EXCLUDED.handle,
       display_name = COALESCE(EXCLUDED.display_name, track_users.display_name),
       avatar_url   = COALESCE(EXCLUDED.avatar_url, track_users.avatar_url),
       updated_at   = NOW()
     RETURNING *`,
    [params.did, params.handle, params.display_name ?? null, params.avatar_url ?? null]
  );
  return rows[0]!;
}

export async function getTrackUserById(id: bigint | number): Promise<TrackUser | null> {
  const { rows } = await pool.query<TrackUser>(
    'SELECT * FROM track_users WHERE id = $1', [id]
  );
  return rows[0] ?? null;
}

export const trackAuthRouter = new Hono();

// Client metadata endpoint
trackAuthRouter.get('/client-metadata.json', (c) => {
  return c.json({
    client_id: TRACK_OAUTH_CLIENT_ID,
    client_name: 'Track',
    client_uri: TRACK_BASE_URL,
    redirect_uris: [`${TRACK_BASE_URL}/oauth/callback`],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'atproto',
    dpop_bound_access_tokens: true,
  });
});

// Login page
trackAuthRouter.get('/login', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login — Track</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root { --bg: #0f0f13; --surface: #1a1a23; --text: #e4e4ed; --text-muted: #8888a0; --primary: #6366f1; --primary-hover: #818cf8; --border: #2a2a3a; --radius: 8px; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:var(--bg); color:var(--text); display:flex; justify-content:center; align-items:center; min-height:100vh; }
    .card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:2rem; width:360px; }
    h1 { font-size:1.4rem; margin-bottom:0.3rem; }
    p { color:var(--text-muted); font-size:0.9rem; margin-bottom:1.5rem; }
    label { display:block; font-size:0.85rem; color:var(--text-muted); margin-bottom:0.3rem; }
    input { width:100%; background:var(--bg); color:var(--text); border:1px solid var(--border); padding:0.6rem; border-radius:var(--radius); font-size:0.95rem; margin-bottom:1rem; }
    input:focus { outline:1px solid var(--primary); border-color:var(--primary); }
    button { width:100%; padding:0.6rem; background:var(--primary); color:#fff; border:none; border-radius:var(--radius); cursor:pointer; font-size:0.95rem; }
    button:hover { background:var(--primary-hover); }
  </style>
</head>
<body>
  <div class="card">
    <h1>📡 Track</h1>
    <p>Monitor Bluesky posts by keyword. Sign in with your Bluesky account.</p>
    <form action="/oauth/login" method="GET">
      <label>Bluesky Handle</label>
      <input type="text" name="handle" placeholder="yourname.bsky.social" required autofocus>
      <button type="submit">Sign in with Bluesky</button>
    </form>
  </div>
</body>
</html>`);
});

// Start OAuth flow
trackAuthRouter.get('/oauth/login', async (c) => {
  const handle = c.req.query('handle')?.trim();
  if (!handle) {
    return c.html('<p>Handle required. <a href="/login">Back</a></p>', 400);
  }

  try {
    const client = await getOAuthClient();
    const url = await client.authorize(handle, { scope: 'atproto' });
    return c.redirect(url.toString());
  } catch (err) {
    logger.error({ err, handle }, 'Track OAuth initiation failed');
    return c.html('<p>Failed to start login. <a href="/login">Try again</a></p>', 500);
  }
});

// OAuth callback
trackAuthRouter.get('/oauth/callback', async (c) => {
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

    const user = await upsertTrackUser({ did, handle, display_name: displayName, avatar_url: avatarUrl });

    // Set Track session cookie
    const { createHmac } = await import('crypto');
    const secret = process.env.SESSION_SECRET ?? 'dev-secret';
    const payload = String(user.id);
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    const { setCookie } = await import('hono/cookie');
    setCookie(c, 'track_session', `${payload}.${sig}`, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: TRACK_BASE_URL.startsWith('https://'),
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });

    logger.info({ did, handle, userId: user.id }, 'Track user logged in');
    return c.redirect('/');
  } catch (err) {
    logger.error({ err }, 'Track OAuth callback failed');
    return c.html('<p>Login failed. <a href="/login">Try again</a></p>', 500);
  }
});

// Logout
trackAuthRouter.post('/oauth/logout', async (c) => {
  const { deleteCookie } = await import('hono/cookie');
  deleteCookie(c, 'track_session', { path: '/' });
  return c.redirect('/login');
});

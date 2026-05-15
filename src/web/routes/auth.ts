import { Hono } from 'hono';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { upsertUser } from '../../db/queries/users.js';
import { setSessionCookie, clearSessionCookie } from '../middleware/session.js';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { pool } from '../../db/client.js';
import { enqueueJob } from '../jobEnqueue.js';

// Simple in-memory lock for single-process dev (prevents concurrent token refreshes)
const locks = new Map<string, Promise<unknown>>();
function requestLock<T>(key: string, fn: () => T | PromiseLike<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(() => fn()) as Promise<T>;
  locks.set(key, next.catch(() => {}));
  next.finally(() => { if (locks.get(key) === next) locks.delete(key); });
  return next;
}

export const authRouter = new Hono();

// Lazy-initialized OAuth client (requires DB for state storage)
let _oauthClient: NodeOAuthClient | null = null;

async function getOAuthClient(): Promise<NodeOAuthClient> {
  if (_oauthClient) return _oauthClient;

  _oauthClient = new NodeOAuthClient({
    clientMetadata: {
      client_id: config.BSKY_OAUTH_CLIENT_ID,
      client_name: 'open.news',
      client_uri: config.BASE_URL,
      redirect_uris: [`${config.BASE_URL}/oauth/callback`],
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
          `INSERT INTO oauth_state (key, value, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
           ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = NOW() + INTERVAL '10 minutes'`,
          [key, JSON.stringify(value)]
        );
      },
      async get(key: string) {
        const { rows } = await pool.query<{ value: string }>(
          `SELECT value FROM oauth_state WHERE key = $1 AND expires_at > NOW()`,
          [key]
        );
        return rows[0] ? JSON.parse(rows[0].value) : undefined;
      },
      async del(key: string) {
        await pool.query('DELETE FROM oauth_state WHERE key = $1', [key]);
      },
    },
    sessionStore: {
      async set(sub: string, value: Record<string, unknown>) {
        await pool.query(
          `INSERT INTO oauth_sessions (sub, value) VALUES ($1, $2)
           ON CONFLICT (sub) DO UPDATE SET value = $2, updated_at = NOW()`,
          [sub, JSON.stringify(value)]
        );
      },
      async get(sub: string) {
        const { rows } = await pool.query<{ value: string }>(
          'SELECT value FROM oauth_sessions WHERE sub = $1',
          [sub]
        );
        return rows[0] ? JSON.parse(rows[0].value) : undefined;
      },
      async del(sub: string) {
        await pool.query('DELETE FROM oauth_sessions WHERE sub = $1', [sub]);
      },
    },
  });

  return _oauthClient;
}

// GET /oauth/client-metadata.json
authRouter.get('/oauth/client-metadata.json', (c) => {
  return c.json({
    client_id: config.BSKY_OAUTH_CLIENT_ID,
    client_name: 'open.news',
    client_uri: config.BASE_URL,
    redirect_uris: [`${config.BASE_URL}/oauth/callback`],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'atproto',
    dpop_bound_access_tokens: true,
  });
});

// GET /oauth/login?handle=alice.bsky.social
authRouter.get('/oauth/login', async (c) => {
  const handle = c.req.query('handle')?.trim();
  const returnTo = c.req.query('returnTo') || '';
  if (!handle) {
    return c.html('<p>Handle required. <a href="/login">Back</a></p>', 400);
  }

  try {
    const client = await getOAuthClient();
    const url = await client.authorize(handle, { scope: 'atproto' });

    // Persist returnTo in a short-lived cookie so callback can redirect back
    if (returnTo) {
      const { setCookie } = await import('hono/cookie');
      setCookie(c, 'oauth_return_to', returnTo, {
        path: '/',
        maxAge: 600,
        httpOnly: true,
        secure: process.env.NODE_ENV !== 'development',
      });
    }

    return c.redirect(url.toString());
  } catch (err) {
    logger.error({ err, handle }, 'OAuth initiation failed');
    return c.html('<p>Failed to start OAuth flow. <a href="/login">Try again</a></p>', 500);
  }
});

// GET /oauth/callback
authRouter.get('/oauth/callback', async (c) => {
  const params = c.req.query();

  try {
    const client = await getOAuthClient();
    const { session } = await client.callback(new URLSearchParams(params));

    const did = session.did;

    let handle: string = did;
    let displayName: string | null = null;
    let avatarUrl: string | null = null;
    try {
      // Use the public AppView API — auth token lacks scope for this endpoint
      const profileUrl = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`;
      const profileRes = await fetch(profileUrl);
      if (profileRes.ok) {
        const p = await profileRes.json() as { handle?: string; displayName?: string; avatar?: string };
        handle = p.handle ?? did;
        displayName = p.displayName ?? null;
        avatarUrl = p.avatar ?? null;
      }
    } catch (profileErr) {
      logger.warn({ profileErr, did }, 'Could not fetch profile, using DID as handle');
    }

    const user = await upsertUser({ did, handle, display_name: displayName, avatar_url: avatarUrl });

    setSessionCookie(c, user.id);
    logger.info({ did, handle, userId: user.id }, 'User logged in via OAuth');

    await enqueueJob('syncFollows', { userId: user.id.toString(), userDid: did });

    // Redirect to returnTo if set, otherwise default to /chat
    const { getCookie, setCookie: setC } = await import('hono/cookie');
    const returnTo = getCookie(c, 'oauth_return_to');
    // Clear the cookie
    setC(c, 'oauth_return_to', '', { path: '/', maxAge: 0 });

    return c.redirect(returnTo || '/chat?briefing=1');
  } catch (err) {
    logger.error({ err }, 'OAuth callback failed');
    return c.html('<p>Login failed. <a href="/login">Try again</a></p>', 500);
  }
});

// POST /oauth/logout
authRouter.post('/oauth/logout', (c) => {
  clearSessionCookie(c);
  return c.redirect('/login');
});

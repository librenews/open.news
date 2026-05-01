import { Hono } from 'hono';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { pool } from '../../db/client.js';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';

const locks = new Map<string, Promise<unknown>>();
function requestLock<T>(key: string, fn: () => T | PromiseLike<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(() => fn()) as Promise<T>;
  locks.set(key, next.catch(() => { }));
  next.finally(() => { if (locks.get(key) === next) locks.delete(key); });
  return next;
}

export const authRouter = new Hono();

// Lazy-initialize explicitly bound to LONGFORM_DOMAIN
let _oauthClient: NodeOAuthClient | null = null;

export async function getLongformAuthClient(): Promise<NodeOAuthClient> {
  if (_oauthClient) return _oauthClient;

  const clientUri = `https://${config.LONGFORM_DOMAIN}`;

  _oauthClient = new NodeOAuthClient({
    clientMetadata: {
      client_name: 'Longform Publishing (open.news)',
      client_id: `${clientUri}/client-metadata.json`,
      client_uri: clientUri,
      redirect_uris: [`${clientUri}/oauth/callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'atproto repo:site.standard.document blob:image/jpeg repo:app.bsky.feed.like repo:app.bsky.feed.repost',
      dpop_bound_access_tokens: true,
    },
    requestLock,
    stateStore: {
      async set(key: string, value: Record<string, unknown>) {
        await pool.query(
          `INSERT INTO longform_oauth_state (key, value, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
           ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = NOW() + INTERVAL '10 minutes'`,
          [key, JSON.stringify(value)]
        );
      },
      async get(key: string) {
        const { rows } = await pool.query<{ value: string }>(
          `SELECT value FROM longform_oauth_state WHERE key = $1 AND expires_at > NOW()`,
          [key]
        );
        return rows[0] ? JSON.parse(rows[0].value) : undefined;
      },
      async del(key: string) {
        await pool.query('DELETE FROM longform_oauth_state WHERE key = $1', [key]);
      },
    },
    sessionStore: {
      async set(sub: string, value: Record<string, unknown>) {
        await pool.query(
          `INSERT INTO longform_oauth_sessions (sub, value) VALUES ($1, $2)
           ON CONFLICT (sub) DO UPDATE SET value = $2, updated_at = NOW()`,
          [sub, JSON.stringify(value)]
        );
      },
      async get(sub: string) {
        const { rows } = await pool.query<{ value: string }>(
          'SELECT value FROM longform_oauth_sessions WHERE sub = $1',
          [sub]
        );
        return rows[0] ? JSON.parse(rows[0].value) : undefined;
      },
      async del(sub: string) {
        await pool.query('DELETE FROM longform_oauth_sessions WHERE sub = $1', [sub]);
      },
    },
  });

  return _oauthClient;
}

authRouter.get('/client-metadata.json', async (c) => {
  const clientUri = `https://${config.LONGFORM_DOMAIN}`;
  return c.json({
    client_id: `${clientUri}/client-metadata.json`,
    client_name: 'Longform Publishing (open.news)',
    client_uri: clientUri,
    redirect_uris: [`${clientUri}/oauth/callback`],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'atproto repo:site.standard.document blob:image/jpeg repo:app.bsky.feed.like repo:app.bsky.feed.repost',
    dpop_bound_access_tokens: true,
  });
});

authRouter.get('/oauth/login', async (c) => {
  const handle = c.req.query('handle')?.trim();
  if (!handle) {
    return c.redirect('/');
  }

  try {
    const client = await getLongformAuthClient();
    const url = await client.authorize(handle, { scope: 'atproto' });
    return c.redirect(url.toString());
  } catch (err) {
    logger.error({ err, handle }, 'Longform OAuth initiation failed');
    return c.text('Failed to initiate login flow', 500);
  }
});

authRouter.get('/oauth/callback', async (c) => {
  const params = c.req.query();
  try {
    const client = await getLongformAuthClient();
    const { session } = await client.callback(new URLSearchParams(params));
    const did = session.did;

    // Cookie specifically targeting longform domain sessions
    setCookie(c, 'lf_session', did, {
      path: '/',
      secure: process.env.NODE_ENV !== 'development',
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30
    });

    logger.info({ event: 'longform_login', did }, 'User successfully authenticated via AT Protocol');

    return c.redirect('/');
  } catch (err) {
    logger.error({ err }, 'Longform OAuth callback parsing failed');
    return c.text('Login failure across authentication bridge', 500);
  }
});

authRouter.get('/logout', async (c) => {
  setCookie(c, 'lf_session', '', { maxAge: 0, path: '/' });
  return c.redirect('/');
});

export async function getSession(c: any): Promise<string | null> {
  return getCookie(c, 'lf_session') || null;
}

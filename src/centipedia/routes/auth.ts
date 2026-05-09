import { Hono } from 'hono';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { pool } from '../../db/client.js';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { Agent } from '@atproto/api';

const locks = new Map<string, Promise<unknown>>();
function requestLock<T>(key: string, fn: () => T | PromiseLike<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(() => fn()) as Promise<T>;
  locks.set(key, next.catch(() => { }));
  next.finally(() => { if (locks.get(key) === next) locks.delete(key); });
  return next;
}

export const authRouter = new Hono();

// Lazy-initialize explicitly bound to CENTIPEDIA_DOMAIN
let _oauthClient: NodeOAuthClient | null = null;

export async function getCentipediaAuthClient(): Promise<NodeOAuthClient> {
  if (_oauthClient) return _oauthClient;

  const clientUri = `https://${config.CENTIPEDIA_DOMAIN}`;

  _oauthClient = new NodeOAuthClient({
    clientMetadata: {
      client_name: 'Centipedia (open.news)',
      client_id: `${clientUri}/client-metadata.json?v=6`,
      client_uri: clientUri,
      redirect_uris: [`${clientUri}/oauth/callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'atproto transition:email repo:site.standard.document repo:site.standard.graph.subscription blob:image/jpeg repo:app.bsky.feed.like repo:app.bsky.feed.repost',
      dpop_bound_access_tokens: true,
    },
    requestLock,
    stateStore: {
      async set(key: string, value: Record<string, unknown>) {
        await pool.query(
          `INSERT INTO centipedia_oauth_state (key, value, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
           ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = NOW() + INTERVAL '10 minutes'`,
          [key, JSON.stringify(value)]
        );
      },
      async get(key: string) {
        const { rows } = await pool.query<{ value: string }>(
          `SELECT value FROM centipedia_oauth_state WHERE key = $1 AND expires_at > NOW()`,
          [key]
        );
        return rows[0] ? JSON.parse(rows[0].value) : undefined;
      },
      async del(key: string) {
        await pool.query('DELETE FROM centipedia_oauth_state WHERE key = $1', [key]);
      },
    },
    sessionStore: {
      async set(sub: string, value: Record<string, unknown>) {
        await pool.query(
          `INSERT INTO centipedia_oauth_sessions (sub, value) VALUES ($1, $2)
           ON CONFLICT (sub) DO UPDATE SET value = $2, updated_at = NOW()`,
          [sub, JSON.stringify(value)]
        );
      },
      async get(sub: string) {
        const { rows } = await pool.query<{ value: string }>(
          'SELECT value FROM centipedia_oauth_sessions WHERE sub = $1',
          [sub]
        );
        return rows[0] ? JSON.parse(rows[0].value) : undefined;
      },
      async del(sub: string) {
        await pool.query('DELETE FROM centipedia_oauth_sessions WHERE sub = $1', [sub]);
      },
    },
  });

  return _oauthClient;
}

authRouter.get('/client-metadata.json', async (c) => {
  const clientUri = `https://${config.CENTIPEDIA_DOMAIN}`;
  return c.json({
    client_id: `${clientUri}/client-metadata.json?v=6`,
    client_name: 'Centipedia (open.news)',
    client_uri: clientUri,
    redirect_uris: [`${clientUri}/oauth/callback`],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'atproto transition:email repo:site.standard.document repo:site.standard.graph.subscription blob:image/jpeg repo:app.bsky.feed.like repo:app.bsky.feed.repost',
    dpop_bound_access_tokens: true,
  });
});

authRouter.get('/oauth/login', async (c) => {
  const handle = c.req.query('handle')?.trim();
  if (!handle) {
    return c.redirect('/');
  }

  try {
    const client = await getCentipediaAuthClient();
    const url = await client.authorize(handle, { scope: 'atproto transition:email repo:site.standard.document repo:site.standard.graph.subscription blob:image/jpeg repo:app.bsky.feed.like repo:app.bsky.feed.repost' });
    return c.redirect(url.toString());
  } catch (err) {
    logger.error({ err, handle }, 'Centipedia OAuth initiation failed');
    return c.text('Failed to initiate login flow', 500);
  }
});

authRouter.get('/oauth/callback', async (c) => {
  const params = c.req.query();
  try {
    const client = await getCentipediaAuthClient();
    const { session } = await client.callback(new URLSearchParams(params));
    const did = session.did;

    // Cookie specifically targeting centipedia domain sessions
    setCookie(c, 'cp_session', did, {
      path: '/',
      secure: process.env.NODE_ENV !== 'development',
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30
    });

    // Fetch email and profile via the authenticated session
    let email: string | null = null;
    let emailConfirmed = false;
    let handle = did;
    let displayName: string | null = null;
    let avatarUrl: string | null = null;

    try {
      const agent = new Agent(session);
      // getSession returns email when transition:email scope is granted
      const sessionInfo = await agent.com.atproto.server.getSession();
      email = sessionInfo.data.email || null;
      emailConfirmed = sessionInfo.data.emailConfirmed || false;
      handle = sessionInfo.data.handle || did;
    } catch (e) {
      logger.warn({ err: e, did }, 'Failed to fetch session email (scope may not be granted)');
    }

    // Fetch profile for display name and avatar
    try {
      const profileRes = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`).then(r => r.json()) as any;
      if (profileRes && !profileRes.error) {
        displayName = profileRes.displayName || null;
        avatarUrl = profileRes.avatar || null;
        handle = profileRes.handle || handle;
      }
    } catch (e) {}

    // Upsert user
    await pool.query(
      `INSERT INTO centipedia_users (did, handle, display_name, avatar_url, email, email_confirmed)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (did) DO UPDATE SET
         handle = EXCLUDED.handle,
         display_name = COALESCE(EXCLUDED.display_name, centipedia_users.display_name),
         avatar_url = COALESCE(EXCLUDED.avatar_url, centipedia_users.avatar_url),
         email = COALESCE(EXCLUDED.email, centipedia_users.email),
         email_confirmed = EXCLUDED.email_confirmed,
         updated_at = NOW()`,
      [did, handle, displayName, avatarUrl, email, emailConfirmed]
    );

    logger.info({ event: 'centipedia_login', did, email: email ? '***' : null, emailConfirmed }, 'User successfully authenticated via AT Protocol');

    return c.redirect('/');
  } catch (err) {
    logger.error({ err }, 'Centipedia OAuth callback parsing failed');
    return c.text('Login failure across authentication bridge', 500);
  }
});

authRouter.get('/logout', async (c) => {
  setCookie(c, 'cp_session', '', { maxAge: 0, path: '/' });
  return c.redirect('/');
});

export async function getSession(c: any): Promise<string | null> {
  return getCookie(c, 'cp_session') || null;
}

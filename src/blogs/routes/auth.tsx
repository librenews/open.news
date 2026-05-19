import { Hono } from 'hono';
import { html } from 'hono/html';
import { NodeOAuthClient } from '@atproto/oauth-client-node';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { pool } from '../../db/client.js';
import { setCookie, getCookie } from 'hono/cookie';
import { Agent } from '@atproto/api';
import { BlogsLayout } from '../views/layout.js';

const BLOGS_DOMAIN = process.env.BLOGS_DOMAIN || 'blogs.social';

const locks = new Map<string, Promise<unknown>>();
function requestLock<T>(key: string, fn: () => T | PromiseLike<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(() => fn()) as Promise<T>;
  locks.set(key, next.catch(() => { }));
  next.finally(() => { if (locks.get(key) === next) locks.delete(key); });
  return next;
}

export const blogsAuthRouter = new Hono();

let _oauthClient: NodeOAuthClient | null = null;

async function getBlogsAuthClient(): Promise<NodeOAuthClient> {
  if (_oauthClient) return _oauthClient;

  const clientUri = `https://${BLOGS_DOMAIN}`;

  _oauthClient = new NodeOAuthClient({
    clientMetadata: {
      client_name: 'blogs.social (open.news)',
      client_id: `${clientUri}/client-metadata.json`,
      client_uri: clientUri,
      redirect_uris: [`${clientUri}/oauth/callback`],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'atproto repo:site.standard.document repo:site.standard.graph.subscription',
      dpop_bound_access_tokens: true,
    },
    requestLock,
    stateStore: {
      async set(key: string, value: Record<string, unknown>) {
        await pool.query(
          `INSERT INTO blogs_oauth_state (key, value, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
           ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = NOW() + INTERVAL '10 minutes'`,
          [key, JSON.stringify(value)]
        );
      },
      async get(key: string) {
        const { rows } = await pool.query<{ value: string }>(
          `SELECT value FROM blogs_oauth_state WHERE key = $1 AND expires_at > NOW()`,
          [key]
        );
        return rows[0] ? JSON.parse(rows[0].value) : undefined;
      },
      async del(key: string) {
        await pool.query('DELETE FROM blogs_oauth_state WHERE key = $1', [key]);
      },
    },
    sessionStore: {
      async set(sub: string, value: Record<string, unknown>) {
        await pool.query(
          `INSERT INTO blogs_oauth_sessions (sub, value) VALUES ($1, $2)
           ON CONFLICT (sub) DO UPDATE SET value = $2, updated_at = NOW()`,
          [sub, JSON.stringify(value)]
        );
      },
      async get(sub: string) {
        const { rows } = await pool.query<{ value: string }>(
          'SELECT value FROM blogs_oauth_sessions WHERE sub = $1',
          [sub]
        );
        return rows[0] ? JSON.parse(rows[0].value) : undefined;
      },
      async del(sub: string) {
        await pool.query('DELETE FROM blogs_oauth_sessions WHERE sub = $1', [sub]);
      },
    },
  });

  return _oauthClient;
}

// Serve client metadata for OAuth discovery
blogsAuthRouter.get('/client-metadata.json', async (c) => {
  const clientUri = `https://${BLOGS_DOMAIN}`;
  return c.json({
    client_id: `${clientUri}/client-metadata.json`,
    client_name: 'blogs.social (open.news)',
    client_uri: clientUri,
    redirect_uris: [`${clientUri}/oauth/callback`],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'atproto repo:site.standard.document repo:site.standard.graph.subscription',
    dpop_bound_access_tokens: true,
  });
});

// Login page
blogsAuthRouter.get('/auth/login', async (c) => {
  const session = await getBlogsSession(c);
  if (session) return c.redirect('/');


  return c.html((
    <BlogsLayout title="Sign in — blogs.social" session={null}>
      {html`
        <div class="bl-feed" style="padding-top: 3rem;">
          <div style="max-width: 340px; margin: 0 auto;">
            <h1 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; letter-spacing: -0.02em;">Sign in to blogs.social</h1>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.5rem;">Enter your Bluesky handle to continue.</p>
            <form action="/oauth/login" method="get" style="display: flex; flex-direction: column; gap: 0.75rem;">
              <input
                name="handle"
                type="text"
                placeholder="yourname.bsky.social"
                required
                style="width: 100%; padding: 0.6rem 0.85rem; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); font-size: 0.88rem; font-family: var(--font); outline: none;"
              />
              <button type="submit" class="bl-btn bl-btn-primary" style="width: 100%; justify-content: center; padding: 0.55rem;">
                Sign in with Bluesky
              </button>
            </form>
          </div>
        </div>
      `}
    </BlogsLayout>
  ) as unknown as string);
});

// OAuth initiate
blogsAuthRouter.get('/oauth/login', async (c) => {
  const handle = c.req.query('handle')?.trim();
  if (!handle) return c.redirect('/auth/login');

  try {
    const client = await getBlogsAuthClient();
    const url = await client.authorize(handle, {
      scope: 'atproto repo:site.standard.document repo:site.standard.graph.subscription'
    });
    return c.redirect(url.toString());
  } catch (err) {
    logger.error({ err, handle }, 'Blogs OAuth initiation failed');
    return c.text('Failed to initiate login flow', 500);
  }
});

// OAuth callback
blogsAuthRouter.get('/oauth/callback', async (c) => {
  const params = c.req.query();
  try {
    const client = await getBlogsAuthClient();
    const { session } = await client.callback(new URLSearchParams(params));
    const did = session.did;

    // Set session cookie
    setCookie(c, 'bl_session', did, {
      path: '/',
      secure: true,
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30 // 30 days
    });

    // Fetch profile
    let handle = did;
    let displayName: string | null = null;
    let avatarUrl: string | null = null;
    let email: string | null = null;
    let emailConfirmed = false;

    try {
      const agent = new Agent(session);
      const sessionInfo = await agent.com.atproto.server.getSession();
      handle = sessionInfo.data.handle || did;
      email = sessionInfo.data.email || null;
      emailConfirmed = sessionInfo.data.emailConfirmed || false;
    } catch {}

    try {
      const profileRes = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`
      ).then(r => r.json()) as any;
      if (profileRes && !profileRes.error) {
        displayName = profileRes.displayName || null;
        avatarUrl = profileRes.avatar || null;
        handle = profileRes.handle || handle;
      }
    } catch {}

    // Upsert user
    await pool.query(
      `INSERT INTO blogs_users (did, handle, display_name, avatar_url, email, email_confirmed)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (did) DO UPDATE SET
         handle = EXCLUDED.handle,
         display_name = COALESCE(EXCLUDED.display_name, blogs_users.display_name),
         avatar_url = COALESCE(EXCLUDED.avatar_url, blogs_users.avatar_url),
         email = COALESCE(EXCLUDED.email, blogs_users.email),
         email_confirmed = EXCLUDED.email_confirmed,
         updated_at = NOW()`,
      [did, handle, displayName, avatarUrl, email, emailConfirmed]
    );

    logger.info({ event: 'blogs_login', did }, 'User authenticated on blogs.social');
    return c.redirect('/');
  } catch (err) {
    logger.error({ err }, 'Blogs OAuth callback failed');
    return c.text('Login failed', 500);
  }
});

// Logout
blogsAuthRouter.get('/auth/logout', async (c) => {
  setCookie(c, 'bl_session', '', { maxAge: 0, path: '/' });
  return c.redirect('/');
});

// Helper to get current session
export async function getBlogsSession(c: any): Promise<{ did: string; handle: string } | null> {
  const did = getCookie(c, 'bl_session');
  if (!did) return null;

  try {
    const { rows } = await pool.query(
      'SELECT did, handle FROM blogs_users WHERE did = $1',
      [did]
    );
    if (rows[0]) return { did: rows[0].did, handle: rows[0].handle };
  } catch {}

  return null;
}

export { getBlogsAuthClient };

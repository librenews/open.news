import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createHmac } from 'crypto';
import { config } from '../../lib/config.js';

// Secure cookies whenever BASE_URL is HTTPS — covers Cloudflare tunnels in dev
const SECURE_COOKIES = config.BASE_URL.startsWith('https://');

const COOKIE_NAME = 'session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sign(value: string): string {
  return createHmac('sha256', config.SESSION_SECRET).update(value).digest('hex');
}

export function createSession(userId: bigint | number): string {
  const payload = String(userId);
  return `${payload}.${sign(payload)}`;
}

export function parseSession(cookie: string): bigint | null {
  const dot = cookie.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  if (sign(payload) !== sig) return null;
  try {
    return BigInt(payload);
  } catch {
    return null;
  }
}

/** Attach userId to context if session cookie is valid */
export const sessionMiddleware = createMiddleware<{
  Variables: { userId?: bigint };
}>(async (c, next) => {
  const cookie = getCookie(c, COOKIE_NAME);
  if (cookie) {
    const userId = parseSession(cookie);
    if (userId) c.set('userId', userId);
  }
  await next();
});

/** Require valid session — 401 if not present */
export const sessionRequired = createMiddleware<{
  Variables: { userId: bigint };
}>(async (c, next) => {
  const cookie = getCookie(c, COOKIE_NAME);
  if (!cookie) return c.redirect('/login');
  const userId = parseSession(cookie);
  if (!userId) return c.redirect('/login');
  c.set('userId', userId);
  await next();
});

export function setSessionCookie(c: Parameters<typeof setCookie>[0], userId: bigint | number): void {
  setCookie(c, COOKIE_NAME, createSession(userId), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: SECURE_COOKIES,
    maxAge: MAX_AGE,
    path: '/',
  });
}

export function clearSessionCookie(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

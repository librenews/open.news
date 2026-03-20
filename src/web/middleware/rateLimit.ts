import { createMiddleware } from 'hono/factory';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

/** Simple in-memory IP rate limiter — 100 req/min per IP */
export const rateLimit = createMiddleware(async (c, next) => {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown';

  const now = Date.now();
  const windowMs = 60_000;

  let entry = store.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(ip, entry);
  }

  entry.count++;

  if (entry.count > 100) {
    return c.json({ error: 'Too many requests' }, 429);
  }

  await next();
});

// Periodically clean expired entries to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 60_000);

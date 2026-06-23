import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { getCachedProfile } from '../lib/pdsCache.js';

let subscribedDids: Set<string> = new Set();
let lastSubscribedDidsRefresh = 0;
const REFRESH_INTERVAL_MS = 60_000; // 1 minute

/**
 * Register a new RSS Cloud subscriber.
 */
export async function registerSubscriber(
  feedUrl: string,
  domain: string,
  port: number,
  path: string,
  protocol = 'http-post'
): Promise<void> {
  await db.query(`
    INSERT INTO rss_cloud_subs (feed_url, domain, port, path, protocol, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (feed_url, domain, port, path) DO UPDATE SET updated_at = NOW()
  `, [feedUrl, domain, port, path, protocol]);

  logger.info({ feedUrl, domain, port, path }, 'Registered RSS Cloud subscriber');
  
  // Trigger an asynchronous refresh of the DID cache so this subscription takes effect immediately
  refreshSubscribedDids(true).catch(() => {});
}

/**
 * Notify all subscribers registered for a specific feed URL.
 */
export async function notifyRssCloudSubscribers(feedUrl: string): Promise<void> {
  try {
    const { rows: subs } = await db.query<{ domain: string; port: number; path: string; protocol: string }>(
      'SELECT domain, port, path, protocol FROM rss_cloud_subs WHERE feed_url = $1',
      [feedUrl]
    );

    if (subs.length === 0) return;

    logger.info({ feedUrl, subCount: subs.length }, 'Notifying RSS Cloud subscribers');

    for (const sub of subs) {
      const scheme = (sub.port === 443 || sub.protocol.toLowerCase().includes('https')) ? 'https' : 'http';
      const portPart = (sub.port === 80 && scheme === 'http') || (sub.port === 443 && scheme === 'https') ? '' : `:${sub.port}`;
      const notifyUrl = `${scheme}://${sub.domain}${portPart}${sub.path}`;

      logger.debug({ notifyUrl, feedUrl }, 'Sending RSS Cloud HTTP POST ping');

      fetch(notifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `url=${encodeURIComponent(feedUrl)}`,
      }).then(async (res) => {
        if (!res.ok) {
          logger.warn({ notifyUrl, status: res.status }, 'Failed to notify RSS Cloud subscriber');
        } else {
          logger.debug({ notifyUrl }, 'Successfully notified RSS Cloud subscriber');
        }
      }).catch((err) => {
        logger.warn({ notifyUrl, err: err.message }, 'Error notifying RSS Cloud subscriber');
      });
    }
  } catch (err) {
    logger.error({ err, feedUrl }, 'Failed to notify RSS Cloud subscribers');
  }
}

/**
 * Refresh the in-memory cache of DIDs that have active RSS Cloud subscriptions.
 */
export async function refreshSubscribedDids(force = false): Promise<Set<string>> {
  const now = Date.now();
  if (!force && now - lastSubscribedDidsRefresh < REFRESH_INTERVAL_MS) {
    return subscribedDids;
  }

  try {
    const { rows } = await db.query<{ feed_url: string }>('SELECT DISTINCT feed_url FROM rss_cloud_subs');
    const newDids = new Set<string>();

    for (const r of rows) {
      // Look for /user/:handleOrDid.rss or /user/:handleOrDid.html or fallback /user/:handleOrDid/rss.xml
      const match = r.feed_url.match(/\/user\/([^/.]+)(?:\.rss|\.html|\/rss\.xml)?/);
      if (match) {
        let handleOrDid = match[1];
        if (handleOrDid.startsWith('did:')) {
          newDids.add(handleOrDid);
        } else {
          // Resolve handle to DID
          try {
            const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.identity.resolveHandle?handle=${encodeURIComponent(handleOrDid)}`);
            if (res.ok) {
              const data = await res.json() as any;
              if (data.did) {
                newDids.add(data.did);
              }
            }
          } catch {}
        }
      }
    }

    subscribedDids = newDids;
    lastSubscribedDidsRefresh = now;
    logger.debug({ count: subscribedDids.size }, 'Refreshed subscribed DIDs cache for RSS Cloud');
  } catch (err) {
    logger.error({ err }, 'Failed to refresh subscribed DIDs cache');
  }

  return subscribedDids;
}

/**
 * Synchronously checks if a DID has an active subscription.
 * Triggers background refresh if cache is stale.
 */
export function isActorSubscribed(did: string): boolean {
  if (Date.now() - lastSubscribedDidsRefresh > REFRESH_INTERVAL_MS) {
    refreshSubscribedDids().catch(() => {});
  }
  return subscribedDids.has(did);
}

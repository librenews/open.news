import { Hono } from 'hono';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { getCurrentLineup, generateLineup, persistLineup } from './programmer.js';
import { ChannelLayout } from './views/layout.js';
import { ChannelPage } from './views/channelPage.js';
import { getUserById } from '../db/queries/users.js';

const app = new Hono();

// ── Video Stream Proxy (Supports Range Requests & iOS/Safari) ─────────────────
app.get('/video/proxy/:did/:cid', async (c) => {
  const did = c.req.param('did');
  const cid = c.req.param('cid');
  const targetUrl = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;

  const requestHeaders: Record<string, string> = {};
  const range = c.req.header('range');
  if (range) {
    requestHeaders['Range'] = range;
  }

  try {
    const res = await fetch(targetUrl, { headers: requestHeaders });

    c.status(res.status as any);

    c.header('Content-Type', 'video/mp4');
    c.header('Accept-Ranges', 'bytes');
    c.header('Cache-Control', 'public, max-age=86400');

    const contentLength = res.headers.get('content-length');
    if (contentLength) c.header('Content-Length', contentLength);

    const contentRange = res.headers.get('content-range');
    if (contentRange) c.header('Content-Range', contentRange);

    return c.body(res.body);
  } catch (err) {
    logger.error({ err, did, cid }, 'Video proxy streaming failed');
    return c.text('Proxy error', 500);
  }
});

// ── Root Redirect ─────────────────────────────────────────────────────────────
app.get('/', (c) => {
  return c.redirect('/channel/all');
});

// ── Helper: Get active channels for nav ───────────────────────────────────────
async function getActiveChannels(): Promise<{ slug: string; name: string }[]> {
  try {
    const { rows } = await db.query<{ slug: string; name: string }>(
      `SELECT slug, name FROM channels WHERE is_active = true ORDER BY created_at ASC`
    );
    return rows;
  } catch (err) {
    logger.error({ err }, 'Failed to fetch active channels');
    return [
      { slug: 'all', name: 'All News' },
      { slug: 'politics', name: 'Politics' },
      { slug: 'tech', name: 'Tech & AI' },
      { slug: 'finance', name: 'Finance & Business' },
    ];
  }
}

// ── Channel Page ──────────────────────────────────────────────────────────────
app.get('/channel/:slug', async (c) => {
  const slug = c.req.param('slug');

  // Get channels for nav
  const channels = await getActiveChannels();

  // Find current channel
  const currentChannel = channels.find(ch => ch.slug === slug);
  if (!currentChannel) {
    return c.redirect('/channel/all');
  }

  // Get or generate lineup
  let lineup = null;
  try {
    lineup = await getCurrentLineup(slug);
    if (!lineup) {
      logger.info({ slug }, 'No current lineup found, generating new one');
      lineup = await generateLineup(slug);
      if (lineup) {
        await persistLineup(lineup);
      }
    }
  } catch (err) {
    logger.error({ err, slug }, 'Failed to load/generate lineup');
  }

  // Get logged-in user (if any)
  const userId = c.get('userId') as bigint | undefined;
  let user: { handle: string; displayName: string | null; avatarUrl: string | null } | null = null;
  if (userId) {
    try {
      const dbUser = await getUserById(userId);
      if (dbUser) {
        user = { handle: dbUser.handle, displayName: dbUser.display_name, avatarUrl: dbUser.avatar_url };
      }
    } catch { /* non-fatal */ }
  }

  const pageHtml = ChannelPage({
    lineup,
    channelName: currentChannel.name,
    channelSlug: slug,
  });

  return c.html(
    ChannelLayout({
      title: `${currentChannel.name} — ONN`,
      children: pageHtml,
      activeChannel: slug,
      channels,
      user,
    })
  );
});

// ── Lineup JSON API ───────────────────────────────────────────────────────────
app.get('/channel/:slug/lineup.json', async (c) => {
  const slug = c.req.param('slug');

  try {
    const lineup = await getCurrentLineup(slug);
    if (!lineup) {
      return c.json({ error: 'No lineup available', slug }, 404);
    }
    return c.json(lineup);
  } catch (err) {
    logger.error({ err, slug }, 'Failed to fetch lineup JSON');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export const channelRouter = app;

import { Hono } from 'hono';
import { Agent } from '@atproto/api';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { getCurrentLineup, generateLineup, persistLineup } from './programmer.js';
import { ChannelLayout, type OgMeta } from './views/layout.js';
import { ChannelPage } from './views/channelPage.js';
import { getUserById, getUserByDid } from '../db/queries/users.js';
import { getOAuthClient } from '../web/routes/auth.js';
import { config } from '../lib/config.js';
import { rssFeedRouter } from './rssFeed.js';
import { searchRouter, renderSearchContent } from './search.js';

const app = new Hono();

// Mount RSS feeds and search
app.route('/', rssFeedRouter);
app.route('/', searchRouter);

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

// ── Search Page ───────────────────────────────────────────────────────────────
app.get('/search', async (c) => {
  const q = c.req.query('q') || '';
  const category = c.req.query('category') || '';
  const channels = await getActiveChannels();

  const searchContent = await renderSearchContent(q, category);

  const userId = c.get('userId') as bigint | undefined;
  let user = null;
  if (userId) {
    const dbUser = await getUserById(userId);
    if (dbUser) {
      user = {
        handle: dbUser.handle || dbUser.did,
        displayName: dbUser.displayName || dbUser.handle || dbUser.did,
        avatarUrl: dbUser.avatarUrl || null,
      };
    }
  }

  const title = q ? `"${q}" — Search — ONN` : 'Search — ONN';
  return c.html(
    ChannelLayout({
      title,
      children: searchContent,
      activeChannel: '',
      channels,
      user,
      og: {
        title,
        description: q ? `Search results for "${q}" on the Open News Network.` : 'Search news video transcripts on ONN.',
        url: `${config.BASE_URL}/search${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      },
    })
  );
});

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
    isLoggedIn: !!user,
  });

  // Build OG metadata from top video in lineup
  const topVideo = lineup?.segments.find(s => s.type === 'video');
  const ogImage = topVideo?.did && topVideo?.thumbnailCid
    ? `${config.BASE_URL}/video/proxy/${encodeURIComponent(topVideo.did)}/${encodeURIComponent(topVideo.thumbnailCid)}`
    : '';
  const videoCount = lineup?.segments.filter(s => s.type === 'video').length || 0;
  const ogDesc = topVideo?.storyLabel
    ? `Now playing: ${topVideo.storyLabel}${videoCount > 1 ? ` · ${videoCount} clips` : ''} — ONN`
    : `${currentChannel.name} — Algorithmic video news from the open social web.`;

  return c.html(
    ChannelLayout({
      title: `${currentChannel.name} — ONN`,
      children: pageHtml,
      activeChannel: slug,
      channels,
      user,
      channelSlug: slug,
      og: {
        title: `${currentChannel.name} — ONN`,
        description: ogDesc,
        image: ogImage,
        url: `${config.BASE_URL}/channel/${slug}`,
      },
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

// ── Like / Repost API ─────────────────────────────────────────────────────────

async function getAuthenticatedAgent(c: any): Promise<{ agent: InstanceType<typeof Agent>; did: string } | null> {
  const userId = c.get('userId') as bigint | undefined;
  if (!userId) return null;
  const dbUser = await getUserById(userId);
  if (!dbUser) return null;
  try {
    const client = await getOAuthClient();
    const oauthSession = await client.restore(dbUser.did);
    return { agent: new Agent(oauthSession), did: dbUser.did };
  } catch (err) {
    logger.error({ err, did: dbUser.did }, 'Failed to restore OAuth session');
    return null;
  }
}

// Parse an AT URI into its components
function parseAtUri(uri: string): { repo: string; collection: string; rkey: string } | null {
  const m = uri.match(/^at:\/\/([^\/]+)\/([^\/]+)\/([^\/]+)$/);
  if (!m) return null;
  return { repo: m[1], collection: m[2], rkey: m[3] };
}

app.post('/api/like', async (c) => {
  const auth = await getAuthenticatedAgent(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const { uri, cid } = await c.req.json();
    if (!uri) return c.json({ error: 'Missing uri' }, 400);

    const parsed = parseAtUri(uri);
    if (!parsed) return c.json({ error: 'Invalid AT URI' }, 400);

    const res = await auth.agent.com.atproto.repo.createRecord({
      repo: auth.did,
      collection: 'app.bsky.feed.like',
      record: {
        $type: 'app.bsky.feed.like',
        subject: { uri, cid: cid || '' },
        createdAt: new Date().toISOString(),
      },
    });

    return c.json({ success: true, likeUri: res.data.uri });
  } catch (err) {
    logger.error({ err }, 'Like failed');
    return c.json({ error: 'Like failed' }, 500);
  }
});

app.post('/api/repost', async (c) => {
  const auth = await getAuthenticatedAgent(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const { uri, cid } = await c.req.json();
    if (!uri) return c.json({ error: 'Missing uri' }, 400);

    const parsed = parseAtUri(uri);
    if (!parsed) return c.json({ error: 'Invalid AT URI' }, 400);

    const res = await auth.agent.com.atproto.repo.createRecord({
      repo: auth.did,
      collection: 'app.bsky.feed.repost',
      record: {
        $type: 'app.bsky.feed.repost',
        subject: { uri, cid: cid || '' },
        createdAt: new Date().toISOString(),
      },
    });

    return c.json({ success: true, repostUri: res.data.uri });
  } catch (err) {
    logger.error({ err }, 'Repost failed');
    return c.json({ error: 'Repost failed' }, 500);
  }
});

export const channelRouter = app;

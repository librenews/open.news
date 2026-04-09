import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import * as cheerio from 'cheerio';
import { serveStatic } from '@hono/node-server/serve-static';
import { getCookie } from 'hono/cookie';
import { createHmac } from 'crypto';
import { logger } from '../lib/logger.js';
import {
  createTrack, getTracksByUserId, getTrackById, getTrackByFeedToken,
  deleteTrack as dbDeleteTrack, updateTrackKeywords, updateTrackQueryEmbedding, toggleTrackActive,
  updateTrack,
  getMatchesByTrackId, getMatchesByUserId, getMatchCountByTrack,
  getFeedSkeletonMatches, getTrackByUuid,
} from '../db/queries/tracks.js';
import { logFeedRequest, getFeedMetricsTotals, getFeedMetricsChartData } from '../db/queries/metrics.js';
import { RichText, Agent } from '@atproto/api';
import { upsertTrackQuery, deleteTrackQuery } from './opensearch.js';
import { embedText } from './embedClient.js';
import { trackAuthRouter, getTrackUserById, getTrackUserByDid, getTrackUserByFeedToken, getOAuthClient, type TrackUser } from './auth.js';
import { createMiddleware } from 'hono/factory';
import { Redis } from 'ioredis';

const TRACK_PORT = Number(process.env.TRACK_PORT ?? 4200);
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-secret';

type Env = { Variables: { userId: bigint } };
export const app = new Hono<Env>();

// ─── Static files (only serve actual file requests) ─────────────────────────
app.use('/favicon.png', serveStatic({ root: './src/track/public', path: 'favicon.png' }));
app.use('/logo.png', serveStatic({ root: './src/track/public', path: 'logo.png' }));
app.use('/home-logo.png', serveStatic({ root: './src/track/public', path: 'home-logo.png' }));
app.use('/.well-known/did.json', serveStatic({ root: './src/track/public', path: '.well-known/did.json' }));

// ─── Track session middleware ───────────────────────────────────────────────

function parseTrackSession(cookie: string): bigint | null {
  const dot = cookie.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  if (expected !== sig) return null;
  try { return BigInt(payload); } catch { return null; }
}

const trackSessionOptional = createMiddleware<{
  Variables: { userId?: bigint };
}>(async (c, next) => {
  const cookie = getCookie(c, 'track_session');
  if (cookie) {
    const userId = parseTrackSession(cookie);
    if (userId) c.set('userId', userId);
  }
  await next();
});

const trackSessionRequired = createMiddleware<{
  Variables: { userId: bigint };
}>(async (c, next) => {
  const cookie = getCookie(c, 'track_session');
  if (!cookie) return c.redirect('/login');
  const userId = parseTrackSession(cookie);
  if (!userId) return c.redirect('/login');
  c.set('userId', userId);
  await next();
});

// ─── Auth routes ────────────────────────────────────────────────────────────
app.use('*', trackSessionOptional as never);
app.route('/', trackAuthRouter);


// ─── Public: RSS feeds ──────────────────────────────────────────────────────

app.get('/rss/:token', async (c) => {
  const track = await getTrackByFeedToken(c.req.param('token'));
  if (!track) return c.text('Not found', 404);

  const matches = await getMatchesByTrackId(track.id, 100);
  return c.body(buildRss(track.name, matches), 200, {
    'Content-Type': 'application/rss+xml; charset=utf-8',
  });
});

app.get('/rss/user/:token', async (c) => {
  const user = await getTrackUserByFeedToken(c.req.param('token'));
  if (!user) return c.text('Not found', 404);

  const matches = await getMatchesByUserId(user.id, 100);
  return c.body(buildRss('All Matches', matches), 200, {
    'Content-Type': 'application/rss+xml; charset=utf-8',
  });
});

// ─── Bluesky Feed Generator XRPC ───────────────────────────────────────────

const FEED_RKEY = 'track-matches';
const FEED_EXPLAINER_URI = process.env.TRACK_FEED_EXPLAINER_URI ?? '';

app.get('/xrpc/app.bsky.feed.describeFeedGenerator', (c) => {
  return c.json({
    did: 'did:web:track.social',
    feeds: [
      { uri: `at://did:web:track.social/app.bsky.feed.generator/${FEED_RKEY}` },
    ],
  });
});

app.get('/xrpc/app.bsky.feed.getFeedSkeleton', async (c) => {
  const feedParam = c.req.query('feed') ?? '';

  const rkeyMatch = feedParam.match(/\/app\.bsky\.feed\.generator\/([^/]+)$/);
  if (!rkeyMatch) {
    logger.warn({ feed: feedParam }, 'Unknown feed requested');
    return c.json({ error: 'UnknownFeed', message: 'Unknown feed' }, 400);
  }
  const rkey = rkeyMatch[1];
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30', 10), 100);
  const cursor = c.req.query('cursor') ?? undefined;

  // Extract requester DID universally for metrics & auth
  const authHeader = c.req.header('Authorization');
  let requesterDid: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      const payloadB64 = token.split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      requesterDid = payload.iss;
    } catch {
      // Ignore
    }
  }

  // Fire-and-forget telemetry logging
  logFeedRequest(rkey, requesterDid, cursor, limit).catch(() => {});

  // 1. Dynamic Track custom feed
  if (rkey !== FEED_RKEY) {
    const track = await getTrackByUuid(rkey);
    if (!track) return c.json({ error: 'UnknownFeed', message: 'Track not found' }, 404);

    const matches = await getMatchesByTrackId(track.id, limit, cursor);
    if (matches.length > 0) {
      return c.json({
        cursor: matches[matches.length - 1].matched_at.toISOString(),
        feed: matches.map((m) => ({ post: m.post_uri })),
      });
    }
    return c.json({ feed: [] });
  }

  // 2. Legacy / Root 'track-matches' feed

  if (requesterDid) {
    const user = await getTrackUserByDid(requesterDid);
    if (user) {
      const matches = await getFeedSkeletonMatches(requesterDid, limit, cursor);
      if (matches.length > 0) {
        return c.json({
          cursor: new Date(matches[matches.length - 1].matched_at).toISOString(),
          feed: matches.map((m) => ({ post: m.post_uri })),
        });
      }
    }
  }

  if (FEED_EXPLAINER_URI && !cursor) {
    return c.json({ feed: [{ post: FEED_EXPLAINER_URI }] });
  }

  return c.json({ feed: [] });
});

// ─── Observability ──────────────────────────────────────────────────────────

app.get('/health', async (c) => {
  const userId = c.get('userId');
  const user = userId ? await getTrackUserById(userId) : null;

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  let stats: Record<string, string> = {};
  let streamLength = 0;
  try {
    stats = await redis.hgetall('track:stats');
    try { streamLength = await redis.xlen('track:posts'); } catch {}
  } finally {
    await redis.quit();
  }

  const lag = stats.stream_lag ? Number(stats.stream_lag) : 0;
  const isLagging = lag > 500;
  
  const lastBatchMs = stats.last_batch_at ? new Date(stats.last_batch_at).getTime() : 0;
  const isGathering = (Date.now() - lastBatchMs) < 120000;

  const firehoseStatus = isGathering
    ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"><div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div> Active</span>`
    : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200"><div class="w-1.5 h-1.5 rounded-full bg-red-500"></div> Stalled</span>`;

  const lagStatus = !isLagging
    ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"><svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Healthy</span>`
    : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"><svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg> Lagging</span>`;

  function timeAgo(dateStr?: string) {
    if (!dateStr) return 'Never';
    const diff = Math.max(0, Date.now() - new Date(dateStr).getTime());
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  const html = `
    <div class="max-w-3xl mx-auto">
      <div class="mb-8">
        <h2 class="text-2xl font-bold text-slate-800">System Health</h2>
        <p class="text-slate-500 text-sm mt-1">Real-time metrics for the Track infrastructure</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div class="text-slate-500 text-xs font-medium uppercase tracking-wider mb-3">Firehose</div>
          <div class="flex items-center justify-between">
            <div class="text-2xl font-semibold text-slate-800">${timeAgo(stats.last_batch_at)}</div>
            ${firehoseStatus}
          </div>
          <div class="text-xs text-slate-400 mt-2">Latest posts ingested</div>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div class="text-slate-500 text-xs font-medium uppercase tracking-wider mb-3">Stream Lag</div>
          <div class="flex items-center justify-between">
            <div class="text-2xl font-semibold text-slate-800">${lag.toLocaleString()}</div>
            ${lagStatus}
          </div>
          <div class="text-xs text-slate-400 mt-2">Unprocessed queue backlog</div>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div class="text-slate-500 text-xs font-medium uppercase tracking-wider mb-3">Last Match</div>
          <div class="text-2xl font-semibold text-slate-800">${timeAgo(stats.last_match_at)}</div>
          <div class="text-xs text-slate-400 mt-2">Latest successful query matched</div>
        </div>
      </div>

      <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3 class="text-sm font-semibold text-slate-800">Lifetime Worker Stats</h3>
        </div>
        <div class="divide-y divide-slate-100">
          <div class="flex justify-between px-5 py-3 text-sm">
            <span class="text-slate-500">Posts Processed</span>
            <span class="font-medium text-slate-800">${Number(stats.posts_processed || 0).toLocaleString()}</span>
          </div>
          <div class="flex justify-between px-5 py-3 text-sm">
            <span class="text-slate-500">Matches Found</span>
            <span class="font-medium text-slate-800">${Number(stats.matches_found || 0).toLocaleString()}</span>
          </div>
          <div class="flex justify-between px-5 py-3 text-sm">
            <span class="text-slate-500">Avg Batch Size</span>
            <span class="font-medium text-slate-800">${Number(stats.batches || 0) > 0 ? Math.round(Number(stats.posts_processed || 0) / Number(stats.batches)).toLocaleString() : 0} posts</span>
          </div>
        </div>
      </div>
    </div>
  `;

  return c.html(renderPage('System Health', user, html));
});

app.get('/stats', async (c) => {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  try {
    // Worker stats from Redis hash
    const stats = await redis.hgetall('track:stats');

    // Stream info — length tells us total unconsumed messages
    let streamLength = 0;
    try {
      streamLength = await redis.xlen('track:posts');
    } catch { /* stream may not exist yet */ }

    await redis.quit();

    return c.json({
      stream: {
        length: streamLength,
        lag: stats.stream_lag ? Number(stats.stream_lag) : null,
        pending: stats.stream_pending ? Number(stats.stream_pending) : null,
        lagCheckedAt: stats.lag_checked_at ?? null,
      },
      processing: {
        postsProcessed: Number(stats.posts_processed ?? 0),
        matchesFound: Number(stats.matches_found ?? 0),
        batches: Number(stats.batches ?? 0),
        avgPostsPerBatch: stats.batches && Number(stats.batches) > 0
          ? Math.round(Number(stats.posts_processed ?? 0) / Number(stats.batches))
          : 0,
      },
      lastBatch: {
        size: Number(stats.last_batch_size ?? 0),
        embedMs: Number(stats.last_embed_ms ?? 0),
        at: stats.last_batch_at ?? null,
      },
    });
  } catch (err) {
    await redis.quit();
    logger.error({ err }, 'Stats query failed');
    return c.json({ error: 'Failed to fetch stats' }, 500);
  }
});

// ─── API Routes ─────────────────────────────────────────────────────────────

app.get('/api/unfurl', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ error: 'URL required' }, 400);

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return c.json({ error: 'Invalid URL scheme' }, 400);
    }
  } catch {
    return c.json({ error: 'Invalid URL' }, 400);
  }

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const cacheKey = `track:unfurl:${url}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      await redis.quit();
      return c.json(JSON.parse(cached));
    }

    const res = await fetch(url, {
      headers: { 'User-Agent': 'TrackSocialBot/1.0 (+https://track.social)' },
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

    const html = await res.text();
    const $ = cheerio.load(html);

    const title = $('meta[property="og:title"]').attr('content') || $('title').text() || '';
    const description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
    let image = $('meta[property="og:image"]').attr('content') || '';
    
    if (image && !image.startsWith('http')) {
      try {
        image = new URL(image, url).toString();
      } catch {}
    }

    const data = { title: title.trim(), description: description.trim(), image: image.trim(), url };
    
    // Cache successful fetch for 7 days
    await redis.setex(cacheKey, 7 * 24 * 60 * 60, JSON.stringify(data));
    await redis.quit();

    return c.json(data);
  } catch (err) {
    await redis.quit();
    logger.warn({ err, url }, 'Unfurl failed');
    // Cache negative result for 1 hour to prevent hammering bad URLs
    await redis.setex(cacheKey, 3600, JSON.stringify({ error: true, url }));
    return c.json({ error: true, url }, 500);
  }
});

app.post('/api/action/:type', async (c) => {
  const userId = c.get('userId');
  const user = await getTrackUserById(userId);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const type = c.req.param('type');
  if (type !== 'like' && type !== 'repost') return c.json({ error: 'Invalid action' }, 400);

  const body = await c.req.json().catch(() => ({}));
  const { uri } = body;
  if (!uri) return c.json({ error: 'Missing uri' }, 400);

  try {
    const { getAgent } = await import('./auth.js');
    const agent = await getAgent(user.did);

    const res = await agent.getPosts({ uris: [uri] });
    const post = res.data.posts[0];
    if (!post) {
      return c.json({ error: 'Post not found on network' }, 404);
    }
    const cid = post.cid;

    if (type === 'like') {
      await agent.like(uri, cid);
    } else {
      await agent.repost(uri, cid);
    }

    return c.json({ success: true });
  } catch (err: any) {
    logger.error({ err, uri, type }, 'ATProto action failed');
    return c.json({ error: err.message || 'Action failed' }, 500);
  }
});

// ─── Legal Pages ────────────────────────────────────────────────────────────

const privacyHtml = `
<div class="prose prose-slate max-w-none text-slate-800">
  <h2 class="text-2xl font-semibold mb-2">Privacy Policy</h2>
  <p class="text-sm text-slate-500 mb-8"><strong>Last updated:</strong> March 2026</p>

  <h3 class="text-lg font-medium mt-6 mb-2">1. Overview</h3>
  <p class="mb-4">This service provides a feed of relevant content by processing publicly available data from the Bluesky network and matching it against user-defined queries.</p>
  <p class="mb-4">We are committed to collecting as little personal data as possible.</p>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">2. Information We Collect</h3>
  <p class="mb-2">We may collect:</p>
  <ul class="list-disc pl-5 mb-4 space-y-1 text-slate-700">
    <li><strong>Account information</strong> (if applicable): email, username</li>
    <li><strong>User queries and preferences</strong> used to generate feeds</li>
    <li><strong>Basic technical data</strong> such as IP address, browser type, and request logs</li>
  </ul>
  <p class="mb-4">User queries may be stored to improve relevance and system performance.</p>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">3. How We Use Information</h3>
  <p class="mb-2">We use collected information to:</p>
  <ul class="list-disc pl-5 mb-4 space-y-1 text-slate-700">
    <li>Provide and improve the service</li>
    <li>Match user queries against incoming content</li>
    <li>Maintain system performance and prevent abuse</li>
  </ul>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">4. Data Sources</h3>
  <p class="mb-4">We index and process <strong>publicly available content</strong> from the Bluesky network, but we do not own it. This content may be removed or changed at the source.</p>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">5. AI and Data Processing</h3>
  <p class="mb-2">We use <strong>locally hosted machine learning models</strong> to generate embeddings and perform semantic search.</p>
  <ul class="list-disc pl-5 mb-4 space-y-1 text-slate-700">
    <li>We do <strong>not send user data to third-party AI services</strong></li>
    <li>All processing is performed on our own infrastructure</li>
  </ul>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">6. Data Sharing</h3>
  <p class="mb-2">We do <strong>not sell or share personal data</strong> with third parties.</p>
  <p class="mb-2">We only collect basic app performance analytics. We do <strong>not use third-party marketing or tracking analytics</strong> (like Google Analytics).</p>
  <p class="mb-4">We may use infrastructure providers (e.g., hosting) that process data on our behalf, but they do not have independent rights to use your data.</p>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">7. Data Retention</h3>
  <p class="mb-2">We retain data only as long as necessary to operate the service.</p>
  <p class="mb-4">Users may request deletion of their data where applicable.</p>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">8. Security</h3>
  <p class="mb-4">We take reasonable measures to protect data, but no system is completely secure.</p>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">9. Your Rights</h3>
  <p class="mb-2">Depending on your location, you may have rights to:</p>
  <ul class="list-disc pl-5 mb-4 space-y-1 text-slate-700">
    <li>Access your data</li>
    <li>Request deletion</li>
    <li>Object to certain processing</li>
  </ul>
  <p class="mb-4">To make a request, contact us at: <a href="mailto:app@track.social" class="text-blue-600 hover:underline">app@track.social</a></p>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">10. Changes</h3>
  <p class="mb-4">We may update this policy. Continued use of the service constitutes acceptance of the updated policy.</p>
</div>
`;

const tosHtml = `
<div class="prose prose-slate max-w-none text-slate-800">
  <h2 class="text-2xl font-semibold mb-2">Terms of Service</h2>
  <p class="text-sm text-slate-500 mb-8"><strong>Last updated:</strong> March 2026</p>

  <h3 class="text-lg font-medium mt-6 mb-2">1. Use of Service</h3>
  <p class="mb-2">This service provides content discovery based on user-defined queries and publicly available data.</p>
  <p class="mb-4">You agree to use the service only for lawful purposes.</p>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">2. Content Disclaimer</h3>
  <p class="mb-2">Content surfaced by the service:</p>
  <ul class="list-disc pl-5 mb-4 space-y-1 text-slate-700">
    <li>Is sourced from third parties (e.g., Bluesky)</li>
    <li>We index and process publicly available content but do not own it</li>
    <li>May be incomplete, inaccurate, or outdated</li>
  </ul>
  <p class="mb-4">We do not guarantee the accuracy or reliability of any content.</p>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">3. No Warranty</h3>
  <p class="mb-4">The service is provided <strong>"as is"</strong> and <strong>"as available"</strong> without warranties of any kind.</p>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">4. Limitation of Liability</h3>
  <p class="mb-2">To the fullest extent permitted by law, we are not liable for:</p>
  <ul class="list-disc pl-5 mb-4 space-y-1 text-slate-700">
    <li>Any damages resulting from use of the service</li>
    <li>Loss of data, profits, or business opportunities</li>
  </ul>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">5. Accounts (if applicable)</h3>
  <p class="mb-2">You are responsible for maintaining the security of your account.</p>
  <p class="mb-4">We reserve the right to suspend or terminate accounts for abuse.</p>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">6. Acceptable Use</h3>
  <p class="mb-2">You agree not to:</p>
  <ul class="list-disc pl-5 mb-4 space-y-1 text-slate-700">
    <li>Abuse, scrape, or overload the service</li>
    <li>Attempt to reverse engineer or disrupt the system</li>
    <li>Use the service for illegal activities</li>
  </ul>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">7. Termination</h3>
  <p class="mb-4">We may suspend or terminate access at any time.</p>

  <hr class="my-6 border-slate-200" />

  <h3 class="text-lg font-medium mt-6 mb-2">8. Changes</h3>
  <p class="mb-4">We may update these terms at any time. Continued use constitutes acceptance.</p>
</div>
`;

app.get('/privacy', async (c) => {
  const userId = c.get('userId');
  const user = userId ? await getTrackUserById(userId) : null;
  return c.html(renderPage('Privacy Policy', user, privacyHtml));
});

app.get('/tos', async (c) => {
  const userId = c.get('userId');
  const user = userId ? await getTrackUserById(userId) : null;
  return c.html(renderPage('Terms of Service', user, tosHtml));
});

// ─── Auth wall ──────────────────────────────────────────────────────────────
app.use('/*', trackSessionRequired as never);

// ─── Dashboard ──────────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const userId = c.get('userId');
  const user = await getTrackUserById(userId);
  const tracks = await getTracksByUserId(userId);
  const counts = await getMatchCountByTrack(userId);
  const countMap = new Map(counts.map((r) => [r.track_id, parseInt(r.count, 10)]));

  return c.html(renderPage('Dashboard', user, `
    ${c.req.query('error') === 'publish_failed' ? '<div class="bg-red-50 text-red-700 p-4 rounded-xl mb-6 text-sm border border-red-200 shadow-sm flex items-start gap-3"><svg class="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><div><strong>Feed Publish Failed</strong><br />Bluesky rejected the request because track.social has not been granted explicit permission to create Custom Feeds. Please explicitly click <b>Sign Out</b> from the top right menu, then Sign In again to trigger a fresh authorization flow.</div></div>' : ''}
    <div class="flex justify-between items-center mb-6">
      <div class="flex items-baseline gap-3">
        <h2 class="text-xl font-semibold text-slate-800">Your Tracks</h2>
        <a href="/feed" class="text-sm font-medium text-blue-500 hover:text-blue-700 transition-colors no-underline">(view all matches)</a>
        <a href="https://bsky.app/profile/track.social/feed/track-matches" target="_blank" rel="noopener noreferrer" class="text-sm font-medium text-sky-500 hover:text-sky-700 transition-colors no-underline flex items-baseline gap-1">
          (bluesky feed &nearr;)
        </a>
      </div>
      ${tracks.length >= 5 
        ? `<span class="text-sm font-medium text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">Limit Reached (5/5)</span>`
        : `<button onclick="document.getElementById('new-track-form').classList.toggle('hidden')"
            class="px-4 py-2 bg-gradient-to-r from-blue-500 to-emerald-500 text-white text-sm font-medium rounded-lg hover:from-blue-600 hover:to-emerald-600 transition-all shadow-sm cursor-pointer">
            + New Track
          </button>`}
    </div>

    <form id="new-track-form" method="POST" action="/tracks" class="hidden mb-6 p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Name</label>
        <input type="text" name="name" placeholder="e.g. AI Research" required maxlength="75"
          class="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Search Query <span class="text-slate-400">(English only, optional)</span></label>
        <textarea name="query" id="query-input" placeholder="e.g. artificial intelligence breakthroughs and their impact on society" rows="3" maxlength="600"
          class="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          oninput="document.getElementById('squelch-section').style.display = this.value.trim() ? 'block' : 'none'"></textarea>
        <p class="text-xs text-slate-400 mt-1">Describe what you want to find in natural language. Leave blank for keyword-only matching.</p>
      </div>
      <div id="squelch-section" style="display:none">
        <label class="block text-xs font-medium text-slate-500 mb-1">Squelch <span class="text-slate-400" id="squelch-val">(0.75)</span></label>
        <input type="range" name="threshold" min="0" max="1" step="0.01" value="0.75"
          class="w-full accent-blue-500" oninput="document.getElementById('squelch-val').textContent='('+parseFloat(this.value).toFixed(2)+')'">
        <p class="text-xs text-slate-400 mt-1">Lower = more matches, higher = stricter semantic relevance.</p>
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Keywords <span class="text-slate-400">(optional)</span></label>
        <input type="hidden" name="keywords" id="keywords-value">
        <div id="keywords-wrap" class="flex flex-wrap gap-1.5 p-2 border border-slate-200 rounded-lg min-h-[42px] cursor-text focus-within:ring-2 focus-within:ring-blue-500" onclick="document.getElementById('kw-input').focus()">
          <input type="text" id="kw-input" placeholder="Type a keyword and press Enter"
            class="flex-1 min-w-[140px] border-none outline-none text-sm bg-transparent p-0.5">
        </div>
        <p class="text-xs text-slate-400 mt-1">Exact keyword matches boost ranking alongside semantic search.</p>
      </div>
      <script>
      (function(){
        const wrap = document.getElementById('keywords-wrap');
        const input = document.getElementById('kw-input');
        const hidden = document.getElementById('keywords-value');
        const tags = [];
        function render() {
          wrap.querySelectorAll('.kw-pill').forEach(el => el.remove());
          tags.forEach((tag, i) => {
            const pill = document.createElement('span');
            pill.className = 'kw-pill inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full';
            pill.innerHTML = tag + '<button type="button" class="ml-0.5 text-blue-400 hover:text-blue-700 cursor-pointer" data-i="' + i + '">&times;</button>';
            wrap.insertBefore(pill, input);
          });
          hidden.value = tags.join(',');
        }
        function add(val) {
          const v = val.trim();
          if (v && !tags.includes(v) && tags.length < 5) { tags.push(v); render(); }
          input.value = '';
        }
        input.addEventListener('keydown', function(e) {
          if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && input.value.trim()) {
            e.preventDefault();
            add(input.value);
          }
          if (e.key === 'Backspace' && !input.value && tags.length) {
            tags.pop(); render();
          }
        });
        input.addEventListener('blur', function() { if (input.value.trim()) add(input.value); });
        wrap.addEventListener('click', function(e) {
          if (e.target.dataset.i !== undefined) { tags.splice(Number(e.target.dataset.i), 1); render(); }
        });
      })();
      </script>
      <button type="submit"
        class="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-emerald-500 text-white text-sm font-medium rounded-lg hover:from-blue-600 hover:to-emerald-600 transition-all cursor-pointer">
        Create Track
      </button>
    </form>

    ${tracks.length === 0 ? '<p class="text-slate-400 text-sm">No tracks yet. Create one to start monitoring Bluesky posts.</p>' : ''}

    <div class="space-y-3">
      ${tracks.map((t) => `
        <div class="bg-white border border-slate-200 rounded-xl hover:shadow-sm transition-shadow flex flex-col">
          <a href="/tracks/${t.uuid}" class="block p-4 pb-2 no-underline group">
            <div class="flex justify-between items-center">
              <div class="flex items-center gap-2">
                <span class="font-semibold text-slate-800 group-hover:text-blue-600 transition-colors">${escHtml(t.name)}</span>
                ${t.is_active ? '<span class="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">Active</span>' : '<span class="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">Paused</span>'}
              </div>
              <span class="text-xs font-medium bg-slate-100 text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors px-2.5 py-1 rounded-full">${countMap.get(String(t.id)) ?? 0} matches</span>
            </div>
            <div class="mt-2 text-sm text-slate-500">
              ${t.query ? `<div class="italic">&ldquo;${escHtml(t.query)}&rdquo;</div>` : ''}
              ${t.keywords.length > 0 ? `<div class="${t.query ? 'mt-1' : ''}">Keywords: ${t.keywords.map((k) => `<code class="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-xs font-medium">${escHtml(k)}</code>`).join(' ')}</div>` : ''}
            </div>
          </a>
          <div class="px-4 pb-4 pt-1 flex items-center justify-between text-xs">
            <div class="flex items-center gap-4">
              <a href="/tracks/${t.uuid}/edit" class="text-blue-500 hover:text-blue-700 transition-colors">Edit</a>
              <form method="POST" action="/tracks/${t.uuid}/toggle" class="inline">
                <button type="submit" class="${t.is_active ? 'text-amber-500 hover:text-amber-700' : 'text-emerald-500 hover:text-emerald-700'} transition-colors cursor-pointer">${t.is_active ? 'Pause' : 'Resume'}</button>
              </form>
              <form method="POST" action="/tracks/${t.uuid}/delete" class="inline">
                <button type="submit" class="text-red-400 hover:text-red-600 transition-colors cursor-pointer" onclick="return confirm('Delete this track?')">Delete</button>
              </form>
              <form method="POST" action="/tracks/${t.uuid}/feed" class="inline">
                <button type="submit" class="text-violet-500 hover:text-violet-700 transition-colors cursor-pointer" title="Publish as a Custom Feed to your Bluesky profile">
                  ${t.feed_published ? 'Sync Feed' : 'Publish Feed'}
                </button>
              </form>
            </div>
            <div class="flex items-center gap-3">
              ${t.feed_published ? '<a href="https://bsky.app/profile/' + (user?.handle || '') + '/feed/' + t.uuid + '" target="_blank" class="text-violet-500 hover:text-violet-700 font-medium no-underline transition-colors" title="View on Bluesky">bsky.app &nearr;</a>' : ''}
              <a href="/rss/${t.feed_token}" target="_blank" class="text-orange-400 hover:text-orange-600 transition-colors" title="RSS Feed">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="6.18" cy="17.82" r="2.18"/><path d="M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z"/></svg>
              </a>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `));
});

// ─── Track CRUD ─────────────────────────────────────────────────────────────

app.post('/tracks', async (c) => {
  const userId = c.get('userId');
  
  const tracks = await getTracksByUserId(userId);
  if (tracks.length >= 5) return c.redirect('/?error=limit_reached');

  const body = await c.req.parseBody();
  const name = String(body.name ?? '').trim().slice(0, 75);
  const query = String(body.query ?? '').trim().slice(0, 600);
  const keywordsRaw = String(body.keywords ?? '').trim();
  const keywords = keywordsRaw ? keywordsRaw.split(',').map((k) => k.trim().slice(0, 100)).filter(Boolean).slice(0, 5) : [];
  const threshold = parseFloat(String(body.threshold ?? '0.75'));

  if (!name || (!query && keywords.length === 0)) return c.redirect('/');

  const track = await createTrack(userId, name, keywords, '', query || undefined, isNaN(threshold) ? 0.75 : threshold);
  const osQueryId = await upsertTrackQuery(track.id, keywords);
  await updateTrackKeywords(track.id, keywords, osQueryId);

  // Embed the semantic query if provided
  if (query) {
    try {
      const queryEmbedding = await embedText(query);
      await updateTrackQueryEmbedding(track.id, queryEmbedding);
    } catch (err) {
      logger.error({ err }, 'Failed to embed query — track created without semantic matching');
    }
  }

  return c.redirect('/');
});

app.post('/tracks/:uuid/toggle', async (c) => {
  const userId = c.get('userId');
  const uuid = c.req.param('uuid');
  const track = await getTrackByUuid(uuid);
  if (!track || String(track.user_id) !== String(userId)) return c.text('Not found', 404);

  await toggleTrackActive(track.id);
  return c.redirect('/');
});

// ─── Track Edit ─────────────────────────────────────────────────────────────

app.get('/tracks/:uuid/edit', async (c) => {
  const userId = c.get('userId');
  const uuid = c.req.param('uuid');
  const track = await getTrackByUuid(uuid);
  if (!track || String(track.user_id) !== String(userId)) return c.text('Not found', 404);
  const user = await getTrackUserById(userId);

  return c.html(renderPage('Edit Track', user, `
    <div class="mb-6">
      <a href="/" class="text-sm text-blue-500 hover:text-blue-700 transition-colors no-underline">&larr; Back to Dashboard</a>
    </div>
    <h2 class="text-xl font-semibold text-slate-800 mb-6">Edit: ${escHtml(track.name)}</h2>
    <form method="POST" action="/tracks/${track.uuid}/edit" class="space-y-4 bg-slate-50 border border-slate-200 rounded-xl p-5">
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Name</label>
        <input type="text" name="name" value="${escHtml(track.name)}" required maxlength="75"
          class="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Search Query <span class="text-slate-400">(English only, optional)</span></label>
        <textarea name="query" maxlength="600" rows="3"
          class="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          oninput="document.getElementById('edit-squelch-section').style.display = this.value.trim() ? 'block' : 'none'">${escHtml(track.query ?? '')}</textarea>
        <p class="text-xs text-slate-400 mt-1">Describe what you want to find in natural language. Leave blank for keyword-only matching.</p>
      </div>
      <div id="edit-squelch-section" style="${track.query ? '' : 'display:none'}">
        <label class="block text-xs font-medium text-slate-500 mb-1">Squelch <span class="text-slate-400" id="edit-squelch-val">(${track.threshold.toFixed(2)})</span></label>
        <input type="range" name="threshold" min="0" max="1" step="0.01" value="${track.threshold.toFixed(2)}"
          class="w-full accent-blue-500" oninput="document.getElementById('edit-squelch-val').textContent='('+parseFloat(this.value).toFixed(2)+')'">
        <p class="text-xs text-slate-400 mt-1">Lower = more matches, higher = stricter semantic relevance.</p>
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Keywords <span class="text-slate-400">(optional)</span></label>
        <input type="hidden" name="keywords" id="edit-kw-value" value="${track.keywords.map(k => escHtml(k)).join(',')}">
        <div id="edit-kw-wrap" class="flex flex-wrap gap-1.5 p-2 border border-slate-200 rounded-lg min-h-[42px] cursor-text focus-within:ring-2 focus-within:ring-blue-500 bg-white" onclick="document.getElementById('edit-kw-input').focus()">
          <input type="text" id="edit-kw-input" placeholder="Type and press Enter"
            class="flex-1 min-w-[140px] border-none outline-none text-sm bg-transparent p-0.5">
        </div>
        <p class="text-xs text-slate-400 mt-1">Exact keyword matches boost ranking alongside semantic search.</p>
      </div>
      <script>
      (function(){
        const wrap = document.getElementById('edit-kw-wrap');
        const input = document.getElementById('edit-kw-input');
        const hidden = document.getElementById('edit-kw-value');
        const tags = hidden.value ? hidden.value.split(',').filter(Boolean) : [];
        function render() {
          wrap.querySelectorAll('.kw-pill').forEach(el => el.remove());
          tags.forEach((tag, i) => {
            const pill = document.createElement('span');
            pill.className = 'kw-pill inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full';
            pill.innerHTML = tag + '<button type="button" class="ml-0.5 text-blue-400 hover:text-blue-700 cursor-pointer" data-i="' + i + '">&times;</button>';
            wrap.insertBefore(pill, input);
          });
          hidden.value = tags.join(',');
        }
        function add(val) {
          const v = val.trim();
          if (v && !tags.includes(v) && tags.length < 5) { tags.push(v); render(); }
          input.value = '';
        }
        input.addEventListener('keydown', function(e) {
          if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && input.value.trim()) {
            e.preventDefault();
            add(input.value);
          }
          if (e.key === 'Backspace' && !input.value && tags.length) {
            tags.pop(); render();
          }
        });
        input.addEventListener('blur', function() { if (input.value.trim()) add(input.value); });
        wrap.addEventListener('click', function(e) {
          if (e.target.dataset.i !== undefined) { tags.splice(Number(e.target.dataset.i), 1); render(); }
        });
        render();
      })();
      </script>
      <button type="submit"
        class="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-emerald-500 text-white text-sm font-medium rounded-lg hover:from-blue-600 hover:to-emerald-600 transition-all cursor-pointer">
        Save Changes
      </button>
    </form>
  `));
});

app.post('/tracks/:uuid/edit', async (c) => {
  const userId = c.get('userId');
  const uuid = c.req.param('uuid');
  const track = await getTrackByUuid(uuid);
  if (!track || String(track.user_id) !== String(userId)) return c.text('Not found', 404);

  const body = await c.req.parseBody();
  const name = String(body.name ?? '').trim().slice(0, 75);
  const query = String(body.query ?? '').trim().slice(0, 600);
  const keywordsRaw = String(body.keywords ?? '').trim();
  const threshold = parseFloat(String(body.threshold ?? '0.75'));
  const keywords = keywordsRaw ? keywordsRaw.split(',').map((k) => k.trim().slice(0, 100)).filter(Boolean).slice(0, 5) : [];

  if (!name || (!query && keywords.length === 0)) return c.redirect(`/tracks/${track.uuid}/edit`);

  await updateTrack(track.id, {
    name,
    query: query || null as any,
    keywords,
    threshold: isNaN(threshold) ? 0.75 : threshold,
  });

  // Re-upsert OpenSearch percolate query
  const osQueryId = await upsertTrackQuery(track.id, keywords);
  await updateTrackKeywords(track.id, keywords, osQueryId);

  // Re-embed the query if it changed (or clear if removed)
  if (query && query !== track.query) {
    try {
      const queryEmbedding = await embedText(query);
      await updateTrackQueryEmbedding(track.id, queryEmbedding);
    } catch (err) {
      logger.error({ err }, 'Failed to re-embed query');
    }
  } else if (!query && track.query) {
    // Query was removed — clear embedding
    await updateTrackQueryEmbedding(track.id, null as any);
  }

  return c.redirect('/');
});

app.post('/tracks/:uuid/delete', async (c) => {
  const userId = c.get('userId');
  const uuid = c.req.param('uuid');
  const track = await getTrackByUuid(uuid);
  if (!track || String(track.user_id) !== String(userId)) return c.text('Not found', 404);

  await deleteTrackQuery(track.id);
  await dbDeleteTrack(track.id);
  return c.redirect('/');
});

app.post('/tracks/:uuid/feed', async (c) => {
  const userId = c.get('userId');
  const uuid = c.req.param('uuid');
  const track = await getTrackByUuid(uuid);
  const user = await getTrackUserById(userId);
  if (!track || !user || String(track.user_id) !== String(userId)) return c.text('Not found', 404);

  try {
    const client = await getOAuthClient();
    const oauthSession = await client.restore(user.did);
    const agent = new Agent(oauthSession);

    await agent.com.atproto.repo.putRecord({
      repo: user.did,
      collection: 'app.bsky.feed.generator',
      rkey: track.uuid,
      record: {
        did: 'did:web:track.social',
        displayName: track.name,
        description: `Custom tracking feed for: ${track.name}\n\nPowered by track.social`,
        createdAt: new Date().toISOString(),
      }
    });

    await updateTrack(track.id, { feed_published: true });
  } catch (err) {
    logger.error({ err, uuid }, 'Failed to publish custom feed to PDS');
    return c.redirect('/?error=publish_failed');
  }
  
  return c.redirect('/');
});

// ─── Track Feed ─────────────────────────────────────────────────────────────

app.get('/tracks/:uuid', async (c) => {
  const userId = c.get('userId');
  const uuid = c.req.param('uuid');
  const track = await getTrackByUuid(uuid);
  if (!track || String(track.user_id) !== String(userId)) return c.text('Not found', 404);

  const user = await getTrackUserById(userId);
  const before = c.req.query('before');
  const matches = await getMatchesByTrackId(track.id, 50, before);

  // Fetch telemetry
  const totals = await getFeedMetricsTotals(track.uuid);
  const chartData = await getFeedMetricsChartData(track.uuid);

  return c.html(renderPage(track.name, user, `
    <div class="flex justify-between items-start mb-6">
      <div>
        <a href="/" class="text-sm text-blue-500 hover:text-blue-700 transition-colors">← Back</a>
        <div class="flex items-center gap-3 mt-1">
          <h2 class="text-xl font-semibold text-slate-800">${escHtml(track.name)}</h2>
          <a href="/tracks/${track.uuid}/edit" class="text-xs font-medium text-blue-500 hover:text-blue-700 transition-colors bg-blue-50 px-2 py-1 rounded-md no-underline">Edit Track</a>
        </div>
        <div class="text-sm text-slate-500 mt-1">
          Keywords: ${track.keywords.map((k) => `<code class="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-xs font-medium">${escHtml(k)}</code>`).join(' ')}
        </div>
      </div>
      <div class="flex items-center gap-3">
        <form method="POST" action="/tracks/${track.uuid}/feed" class="inline">
          <button type="submit" class="text-xs font-medium bg-violet-50 text-violet-600 hover:bg-violet-100 hover:text-violet-700 transition-colors px-2 py-1 rounded-md cursor-pointer border-none" title="Publish as a Custom Feed to your Bluesky profile">
            ${track.feed_published ? 'Sync Feed' : 'Publish Feed'}
          </button>
        </form>
        ${track.feed_published ? '<a href="https://bsky.app/profile/' + (user?.handle || '') + '/feed/' + track.uuid + '" target="_blank" class="text-violet-500 hover:text-violet-600 font-medium no-underline transition-colors text-sm" title="View on Bluesky">bsky.app &nearr;</a>' : ''}
        <a href="/rss/${track.feed_token}" target="_blank" class="text-orange-400 hover:text-orange-600 transition-colors no-underline" title="RSS Feed">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="6.18" cy="17.82" r="2.18"/><path d="M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z"/></svg>
        </a>
      </div>
      </div>
    </div>

    ${track.feed_published ? `
      <div class="mb-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="bg-white p-4 rounded-xl border border-slate-200">
          <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Feed Requests (24h)</div>
          <div class="text-2xl font-bold text-slate-800">${totals.total}</div>
        </div>
        <div class="bg-white p-4 rounded-xl border border-slate-200">
          <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Unique Viewers (24h)</div>
          <div class="text-2xl font-bold text-slate-800">${totals.uniqueUsers}</div>
        </div>
        <div class="bg-white p-4 rounded-xl border border-slate-200 md:col-span-1 h-24 relative">
          <canvas id="metricsChart"></canvas>
        </div>
      </div>
      <script>
        const ctx = document.getElementById('metricsChart').getContext('2d');
        const rawData = ${JSON.stringify(chartData)};
        
        // Ensure continuous 24h pad if data is sparse
        const chartLabels = rawData.map(d => new Date(d.label).toLocaleTimeString([], {hour: '2-digit'}));
        const chartCounts = rawData.map(d => d.count);

        new Chart(ctx, {
          type: 'line',
          data: {
            labels: chartLabels,
            datasets: [{
              label: 'Requests',
              data: chartCounts,
              borderColor: '#6366f1',
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              borderWidth: 2,
              fill: true,
              tension: 0.4,
              pointRadius: 0
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { display: false },
              y: { display: false, beginAtZero: true }
            },
            interaction: { mode: 'index', intersect: false }
          }
        });
      </script>
    ` : ''}

    ${renderMatches(matches)}
    ${matches.length === 50 ? `<a href="/tracks/${track.uuid}?before=${matches[matches.length - 1].matched_at.toISOString()}" class="block text-center mt-4 py-2.5 border border-slate-200 text-slate-500 text-sm rounded-lg hover:border-blue-500 hover:text-blue-500 transition-colors no-underline">Load more</a>` : ''}
  `));
});

app.get('/feed', async (c) => {
  const userId = c.get('userId');
  const user = await getTrackUserById(userId);
  const before = c.req.query('before');
  const matches = await getMatchesByUserId(userId, 50, before);

  return c.html(renderPage('All Matches', user, `
    <div class="flex items-center gap-3 mb-6">
      <h2 class="text-xl font-semibold text-slate-800">All Matches</h2>
      <a href="https://bsky.app/profile/track.social/feed/track-matches" target="_blank" class="text-xs font-medium text-blue-500 hover:text-blue-700 transition-colors bg-blue-50 px-2 py-1 rounded-md no-underline">Bluesky Feed</a>
      <a href="/rss/user/${user?.feed_token ?? ''}" target="_blank" class="text-orange-400 hover:text-orange-600 transition-colors" title="RSS Feed — All Matches">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="6.18" cy="17.82" r="2.18"/><path d="M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z"/></svg>
      </a>
    </div>
    ${renderMatches(matches)}
    ${matches.length === 50 ? `<a href="/feed?before=${matches[matches.length - 1].matched_at.toISOString()}" class="block text-center mt-4 py-2.5 border border-slate-200 text-slate-500 text-sm rounded-lg hover:border-blue-500 hover:text-blue-500 transition-colors no-underline">Load more</a>` : ''}
  `));
});

app.get('/metrics', async (c) => {
  const userId = c.get('userId');
  const user = await getTrackUserById(userId);
  
  const totals = await getFeedMetricsTotals(FEED_RKEY);
  const chartData = await getFeedMetricsChartData(FEED_RKEY);

  return c.html(renderPage('Global Metrics', user, `
    <div class="flex items-center gap-3 mb-6">
      <h2 class="text-xl font-semibold text-slate-800">Global Feed Analytics</h2>
      <span class="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-md">track-matches</span>
    </div>

    <div class="mb-8 grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="bg-white p-4 rounded-xl border border-slate-200">
        <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Global Requests (24h)</div>
        <div class="text-2xl font-bold text-slate-800">${totals.total}</div>
      </div>
      <div class="bg-white p-4 rounded-xl border border-slate-200">
        <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Unique Viewers (24h)</div>
        <div class="text-2xl font-bold text-slate-800">${totals.uniqueUsers}</div>
      </div>
      <div class="bg-white p-4 rounded-xl border border-slate-200 md:col-span-1 h-24 relative">
        <canvas id="globalMetricsChart"></canvas>
      </div>
    </div>
    <script>
      const ctx = document.getElementById('globalMetricsChart').getContext('2d');
      const rawData = ${JSON.stringify(chartData)};
      
      const chartLabels = rawData.map(d => new Date(d.label).toLocaleTimeString([], {hour: '2-digit'}));
      const chartCounts = rawData.map(d => d.count);

      new Chart(ctx, {
        type: 'line',
        data: {
          labels: chartLabels,
          datasets: [{
            label: 'Requests',
            data: chartCounts,
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { display: false },
            y: { display: false, beginAtZero: true }
          },
          interaction: { mode: 'index', intersect: false }
        }
      });
    </script>
  `));
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface MatchRow {
  post_uri: string;
  post_did: string;
  post_text: string;
  matched_at: Date;
  track_name?: string;
  track_uuid?: string;
  facets?: string | null;
  embed?: any | null;
}

function renderMatches(matches: MatchRow[]): string {
  if (matches.length === 0) return '<p class="text-slate-400 text-sm">No matches yet.</p>';
  return `<div class="space-y-4">${matches.map((m) => {
    const bskyUrl = m.post_uri.replace('at://', 'https://bsky.app/profile/').replace('/app.bsky.feed.post/', '/post/');
    const ago = timeAgo(m.matched_at);
    let nativeEmbedHtml = '';
    if (m.embed) {
      try {
        const embed = typeof m.embed === 'string' ? JSON.parse(m.embed) : m.embed;
        if (embed.$type === 'app.bsky.embed.external' && embed.external) {
          const ext = embed.external;
          let imgHtml = '';
          if (ext.thumb && ext.thumb.ref && ext.thumb.ref.$link) {
            const thumbUrl = `https://cdn.bsky.app/img/feed_thumbnail/plain/${m.post_did}/${ext.thumb.ref.$link}@jpeg`;
            imgHtml = `<div class="w-1/3 sm:w-1/4 shrink-0 bg-slate-100 flex border-r border-slate-100"><img src="${escHtml(thumbUrl)}" class="w-full h-full object-cover"></div>`;
          }
          let hostname = ext.uri;
          try { hostname = new URL(ext.uri).hostname; } catch {}
          nativeEmbedHtml = `<div class="native-embed"><a href="${escHtml(ext.uri)}" target="_blank" class="flex flex-row items-stretch border border-slate-200 rounded-lg overflow-hidden hover:bg-slate-50 transition-colors no-underline mt-3">
            ${imgHtml}
            <div class="flex flex-col p-3 w-full min-w-0 justify-center gap-1">
              <div class="text-sm font-semibold text-slate-800 truncate" title="${escHtml(ext.title || hostname)}">${escHtml(ext.title || hostname)}</div>
              ${ext.description ? `<div class="text-xs text-slate-500 line-clamp-2">${escHtml(ext.description)}</div>` : ''}
              <div class="text-[10px] text-slate-400 truncate mt-0.5 uppercase tracking-wide font-medium flex items-center gap-1.5">
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
                ${escHtml(hostname)}
              </div>
            </div>
          </a></div>`;
        } else if (embed.$type === 'app.bsky.embed.images' && Array.isArray(embed.images)) {
          const count = embed.images.length;
          const gridClass = count === 1 ? 'grid-cols-1' : count === 2 ? 'grid-cols-2' : 'grid-cols-2';
          const imgTags = embed.images.map((img: any) => {
            if (img.image && img.image.ref && img.image.ref.$link) {
               const thumbUrl = `https://cdn.bsky.app/img/feed_thumbnail/plain/${m.post_did}/${img.image.ref.$link}@jpeg`;
               return `<a href="${thumbUrl.replace('feed_thumbnail', 'feed_fullsize')}" target="_blank" class="block aspect-video bg-slate-100 rounded-lg overflow-hidden border border-slate-200 hover:opacity-90 transition-opacity"><img src="${escHtml(thumbUrl)}" alt="${escHtml(img.alt || '')}" class="w-full h-full object-cover"></a>`;
            }
            return '';
          }).join('');
          nativeEmbedHtml = `<div class="native-embed grid ${gridClass} gap-2 mt-3">${imgTags}</div>`;
        } else if (embed.$type === 'app.bsky.embed.record' && embed.record) {
          const rec = embed.record;
          const authorDid = rec.uri ? rec.uri.split('/')[2] : '';
          const authorHandle = authorDid.slice(0, 16) + '…';
          nativeEmbedHtml = `<div class="native-embed border border-slate-200 rounded-lg p-3 mt-3 bg-slate-50/50">
            <div class="flex items-center gap-2 mb-1.5 author-profile" data-did="${escHtml(authorDid)}">
              <div class="w-4 h-4 rounded-full bg-slate-200 overflow-hidden flex items-center justify-center shrink-0 author-avatar"></div>
              <span class="text-xs font-semibold text-slate-700 author-name">${escHtml(authorHandle)}</span>
              <span class="text-[10px] text-slate-400 font-normal author-handle hidden"></span>
            </div>
            <div class="text-sm text-slate-600 line-clamp-3">${rec.value && rec.value.text ? escHtml(rec.value.text) : 'Quote Post'}</div>
          </div>`;
        }
      } catch (err) {}
    }

    return `
      <div class="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-sm transition-shadow">
        <div class="flex items-center gap-2 mb-3 author-profile" data-did="${m.post_did}">
          <a href="https://bsky.app/profile/${m.post_did}" target="_blank" class="flex items-center gap-2 text-slate-800 hover:text-blue-600 transition-colors no-underline group">
            <div class="w-6 h-6 rounded-full bg-slate-200 overflow-hidden flex items-center justify-center shrink-0 author-avatar">
              <svg class="w-4 h-4 text-slate-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
            </div>
            <span class="text-sm font-semibold author-name">${m.post_did.slice(0, 16)}…</span>
            <span class="text-xs text-slate-400 font-normal author-handle hidden group-hover:text-blue-400"></span>
          </a>
          <span class="text-xs text-slate-400">· <a href="${bskyUrl}" target="_blank" class="text-slate-400 hover:underline">${ago}</a></span>
          ${m.track_name && m.track_uuid ? ` · <a href="/tracks/${m.track_uuid}" class="bg-gradient-to-r from-blue-500 to-emerald-500 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-full hover:opacity-80 transition-opacity no-underline">${escHtml(m.track_name)}</a>` : ''}
        </div>
        <div class="text-sm text-slate-700 leading-relaxed break-words post-body">${renderRichText(m.post_text, m.facets)}</div>
        ${nativeEmbedHtml}
        <div class="unfurled-cards mt-3 space-y-2 empty:hidden"></div>
        <div class="mt-4 flex items-center justify-between">
          <div class="flex items-center gap-4">
            <button class="action-btn text-slate-400 hover:text-pink-500 transition-colors flex items-center gap-1.5 cursor-pointer" data-action="like" data-uri="${m.post_uri}" title="Like">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"></path></svg>
            </button>
            <button class="action-btn text-slate-400 hover:text-emerald-500 transition-colors flex items-center gap-1.5 cursor-pointer" data-action="repost" data-uri="${m.post_uri}" title="Repost">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
            </button>
          </div>
          <a href="${bskyUrl}" target="_blank" class="text-xs text-blue-500 hover:text-blue-700 transition-colors no-underline">View on Bluesky →</a>
        </div>
      </div>`;
  }).join('')}</div>
  <script>
  (async function() {
    // ─── Actions Engine ───
    document.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const action = btn.dataset.action;
        const uri = btn.dataset.uri;
        if (!uri) return;

        // Optimistic UI toggle
        const originalClass = btn.className;
        const originalHtml = btn.innerHTML;
        if (action === 'like') {
          btn.className = 'action-btn text-pink-500 transition-colors flex items-center gap-1.5';
          btn.innerHTML = btn.innerHTML.replace('fill="none"', 'fill="currentColor"');
        }
        if (action === 'repost') {
          btn.className = 'action-btn text-emerald-500 transition-colors flex items-center gap-1.5';
        }

        try {
          const res = await fetch('/api/action/' + action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uri })
          });
          if (!res.ok) throw new Error('Request failed');
        } catch (err) {
          btn.className = originalClass;
          btn.innerHTML = originalHtml;
          alert('Failed to ' + action + ' post. Please try again.');
        }
      });
    });

    // ─── Profile Resolution ───
    const elements = document.querySelectorAll('.author-profile');
    const dids = new Set();
    elements.forEach(el => dids.add(el.dataset.did));
    if (dids.size === 0) return;
    
    // Batch into chunks of 25 (AppView limit)
    const didArray = Array.from(dids);
    for (let i = 0; i < didArray.length; i += 25) {
      const chunk = didArray.slice(i, i + 25);
      const params = chunk.map(d => 'actors=' + encodeURIComponent(d)).join('&');
      try {
        const res = await fetch('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?' + params);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.profiles) {
          data.profiles.forEach(p => {
            document.querySelectorAll('.author-profile[data-did="' + p.did + '"]').forEach(el => {
              if (p.avatar) {
                const av = el.querySelector('.author-avatar');
                if (av) av.innerHTML = '<img src="' + p.avatar + '" class="w-full h-full object-cover">';
              }
              const nameEl = el.querySelector('.author-name');
              const handleEl = el.querySelector('.author-handle');
              if (p.displayName && nameEl && handleEl) {
                nameEl.textContent = p.displayName;
                handleEl.textContent = '@' + p.handle;
                handleEl.classList.remove('hidden');
              } else if (nameEl) {
                nameEl.textContent = '@' + p.handle;
              }
            });
          });
        }
      } catch (e) {
        console.error('Failed to hydrate profiles', e);
      }
    }
  })();

  // ─── Link Unfurling ────────────────────────────────────────────────────────
  (async function() {
    const postBodies = document.querySelectorAll('.post-body');
    postBodies.forEach(async (body) => {
      // Find the first actual external link inside this post
      const link = Array.from(body.querySelectorAll('.rt-link')).find(l => {
        const u = l.href;
        return u.startsWith('http') && !u.includes('bsky.app');
      });
      
      if (!link) return;
      const url = link.href;

      let container = body.nextElementSibling;
      if (container && container.classList.contains('native-embed')) {
        return; // Skip HTML scraping if backend already built a Native Embed card below it
      }
      
      if (!container || !container.classList.contains('unfurled-cards')) return;

      try {
        const res = await fetch('/api/unfurl?url=' + encodeURIComponent(url));
        if (!res.ok) return;
        const data = await res.json();
        if (data.error || !data.title) return;

        // Render sleek tailwind card
        const card = document.createElement('a');
        card.className = 'flex flex-row items-stretch border border-slate-200 rounded-lg overflow-hidden hover:bg-slate-50 transition-colors no-underline';
        card.href = data.url || url;
        card.target = '_blank';
        
        let imgHtml = '';
        if (data.image) {
          imgHtml = '<div class="w-1/3 sm:w-1/4 shrink-0 bg-slate-100 flex border-r border-slate-100"><img src="' + data.image.replace(/"/g, '&quot;') + '" class="w-full h-full object-cover"></div>';
        }
        
        // Ensure hostname parsing is safe
        let hostname = url;
        try { hostname = new URL(data.url || url).hostname; } catch {}

        card.innerHTML = imgHtml + 
          '<div class="flex flex-col p-3 w-full min-w-0 justify-center gap-1">' +
            '<div class="text-sm font-semibold text-slate-800 truncate" title="' + data.title.replace(/"/g, '&quot;') + '">' + data.title + '</div>' +
            (data.description ? '<div class="text-xs text-slate-500 line-clamp-2">' + data.description + '</div>' : '') +
            '<div class="text-[10px] text-slate-400 mt-1 truncate uppercase tracking-wide">' + hostname + '</div>' +
          '</div>';

        container.appendChild(card);
      } catch (e) {}
    });
  })();
  </script>`;
}

function renderRichText(text: string, facetsRaw: any): string {
  let facets;
  if (facetsRaw) {
    try {
      facets = typeof facetsRaw === 'string' ? JSON.parse(facetsRaw) : facetsRaw;
    } catch {
      facets = [];
    }
  }

  const rt = new RichText({ text, facets: Array.isArray(facets) ? facets : undefined });
  if (!rt.facets || rt.facets.length === 0) {
    rt.detectFacetsWithoutResolution();
  }

  let out = '';
  for (const segment of rt.segments()) {
    const escSegment = escHtml(segment.text);
    if (segment.isLink()) {
      out += `<a href="${escHtml(segment.link?.uri || '')}" target="_blank" class="text-blue-500 hover:underline break-all rt-link">${escSegment}</a>`;
    } else if (segment.isMention()) {
      out += `<a href="https://bsky.app/profile/${escHtml(segment.mention?.did || '')}" target="_blank" class="text-blue-500 hover:underline">${escSegment}</a>`;
    } else if (segment.isTag()) {
      out += `<a href="https://bsky.app/hashtag/${escHtml(segment.tag?.tag || '')}" target="_blank" class="text-blue-500 hover:underline">${escSegment}</a>`;
    } else {
      out += escSegment;
    }
  }
  
  return out.replace(/\n/g, '<br>');
}

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function buildRss(title: string, matches: MatchRow[]): string {
  const items = matches.map((m) => {
    const bskyUrl = m.post_uri.replace('at://', 'https://bsky.app/profile/').replace('/app.bsky.feed.post/', '/post/');
    let mediaTags = '';
    let enclosureTags = '';
    let descriptionExt = '';

    if (m.embed) {
      try {
        const embed = typeof m.embed === 'string' ? JSON.parse(m.embed) : m.embed;
        if (embed.$type === 'app.bsky.embed.external' && embed.external) {
          const ext = embed.external;
          if (ext.thumb && ext.thumb.ref && ext.thumb.ref.$link) {
             const thumbUrl = `https://cdn.bsky.app/img/feed_fullsize/plain/${m.post_did}/${ext.thumb.ref.$link}@jpeg`;
             mediaTags += `<media:content url="${escHtml(thumbUrl)}" medium="image"><media:title>${escHtml(ext.title || '')}</media:title><media:description>${escHtml(ext.description || '')}</media:description></media:content>`;
             enclosureTags += `<enclosure url="${escHtml(thumbUrl)}" type="image/jpeg" length="0" />`;
             descriptionExt += `<br/><br/><a href="${escHtml(ext.uri)}"><img src="${escHtml(thumbUrl)}" style="max-width:100%; border-radius:8px;"/><br/><strong>${escHtml(ext.title || 'Link')}</strong></a>`;
          }
        } else if (embed.$type === 'app.bsky.embed.images' && Array.isArray(embed.images)) {
          for (const img of embed.images) {
            if (img.image && img.image.ref && img.image.ref.$link) {
               const thumbUrl = `https://cdn.bsky.app/img/feed_fullsize/plain/${m.post_did}/${img.image.ref.$link}@jpeg`;
               mediaTags += `<media:content url="${escHtml(thumbUrl)}" medium="image"><media:description>${escHtml(img.alt || '')}</media:description></media:content>`;
               if (!enclosureTags) {
                 enclosureTags += `<enclosure url="${escHtml(thumbUrl)}" type="image/jpeg" length="0" />`;
               }
               descriptionExt += `<br/><br/><img src="${escHtml(thumbUrl)}" alt="${escHtml(img.alt || '')}" style="max-width:100%; border-radius:8px;" />`;
            }
          }
        } else if (embed.$type === 'app.bsky.embed.record' && embed.record) {
          const rec = embed.record;
          if (rec.value && rec.value.text) {
             descriptionExt += `<br/><br/><blockquote style="border-left:4px solid #cbd5e1; padding-left:12px; margin-left:0; color:#475569;">${escHtml(rec.value.text)}</blockquote>`;
          }
        }
      } catch (e) {}
    }

    const postTitle = m.post_text ? m.post_text.slice(0, 100) : 'Bluesky Post';
    const finalDescription = `${renderRichText(m.post_text, m.facets)}${descriptionExt}`;

    return `<item>
      <title>${escHtml(postTitle)}</title>
      <link>${bskyUrl}</link>
      <description><![CDATA[${finalDescription}]]></description>
      <pubDate>${m.matched_at.toUTCString()}</pubDate>
      <guid>${m.post_uri}</guid>
      <author>${m.post_did}</author>
      ${enclosureTags}
      ${mediaTags}
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Track: ${escHtml(title)}</title>
    <description>Bluesky posts matching "${escHtml(title)}"</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;
}

function renderPage(title: string, user: TrackUser | null, content: string): string {
  const adminHandles = (process.env.ADMIN_HANDLES ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  const isAdmin = user ? (adminHandles.length === 0 || adminHandles.includes(user.handle.toLowerCase())) : false;
  const mainAppUrl = process.env.BASE_URL ?? 'https://open.news';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)} — Track</title>
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-slate-50 font-[Inter] text-slate-800 min-h-screen">
  <nav class="bg-white border-b border-slate-200 sticky top-0 z-10">
    <div class="max-w-3xl mx-auto px-4 flex justify-between items-center h-14">
      <a href="/" class="flex items-center gap-2 no-underline">
        <img src="/logo.png" alt="Track" class="h-7">
      </a>
      <div class="flex items-center gap-4">
        ${user ? `
        <div class="relative group">
          <button class="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 overflow-hidden ring-2 ring-transparent group-hover:ring-blue-500 transition-all focus:outline-none">
            ${user.avatar_url ? `<img src="${escHtml(user.avatar_url)}" alt="${escHtml(user.handle)}" class="w-full h-full object-cover">` : `<span class="text-xs font-semibold text-slate-500">${escHtml(user.handle.slice(0, 2).toUpperCase())}</span>`}
          </button>
          <div class="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20 overflow-hidden">
            <div class="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <p class="text-sm font-medium text-slate-900 truncate">${escHtml(user.display_name ?? user.handle)}</p>
              <p class="text-xs text-slate-500 truncate">@${escHtml(user.handle)}</p>
            </div>
            <div class="border-b border-slate-100 py-1">
              <a href="/metrics" class="block w-full text-left px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition-colors no-underline">Global Metrics</a>
            </div>
            ${isAdmin ? `
            <div class="border-b border-slate-100 py-1">
              <a href="${mainAppUrl}/admin" class="block w-full text-left px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition-colors no-underline">Admin Dashboard</a>
              <a href="${mainAppUrl}/admin/product" class="block w-full text-left px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition-colors no-underline">Product Feedback</a>
              <a href="/health" class="block w-full text-left px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition-colors no-underline">System Health</a>
            </div>
            ` : ''}
            <form method="POST" action="/oauth/logout" class="block w-full">
              <button type="submit" class="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-slate-50 transition-colors cursor-pointer focus:outline-none">Sign out</button>
            </form>
          </div>
        </div>
        ` : ''}
      </div>
    </div>
  </nav>
  <main class="max-w-3xl mx-auto px-4 py-8 min-h-[calc(100vh-8rem)]">
    ${content}
  </main>
  <footer class="max-w-3xl mx-auto px-4 py-6 text-center text-sm text-slate-500 border-t border-slate-200 mt-auto">
    <p>
      <a href="/privacy" class="hover:text-slate-800 transition-colors no-underline">Privacy Policy</a> | 
      <a href="/tos" class="hover:text-slate-800 transition-colors no-underline">Terms of Service</a> | 
      Contact: <a href="mailto:app@track.social" class="hover:text-slate-800 transition-colors no-underline">app@track.social</a>
    </p>
  </footer>
</body>
</html>`;
}

// ─── Start ──────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: TRACK_PORT }, () => {
  logger.info({ port: TRACK_PORT }, 'Track web server started');
});

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { getCookie } from 'hono/cookie';
import { createHmac } from 'crypto';
import { logger } from '../lib/logger.js';
import {
  createTrack, getTracksByUserId, getTrackById, getTrackByFeedToken,
  deleteTrack as dbDeleteTrack, updateTrackKeywords, updateTrackQueryEmbedding, toggleTrackActive,
  updateTrack,
  getMatchesByTrackId, getMatchesByUserId, getMatchCountByTrack,
  getFeedSkeletonMatches,
} from '../db/queries/tracks.js';
import { upsertTrackQuery, deleteTrackQuery } from './opensearch.js';
import { embedText } from './embedClient.js';
import { trackAuthRouter, getTrackUserById, getTrackUserByDid } from './auth.js';
import { createMiddleware } from 'hono/factory';
import { Redis } from 'ioredis';

const TRACK_PORT = Number(process.env.TRACK_PORT ?? 4200);
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-secret';

type Env = { Variables: { userId: bigint } };
const app = new Hono<Env>();

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

  // Match on rkey — Bluesky sends the publisher's DID, not the generator's
  if (!feedParam.endsWith(`/app.bsky.feed.generator/${FEED_RKEY}`)) {
    logger.warn({ feed: feedParam }, 'Unknown feed requested');
    return c.json({ error: 'UnknownFeed', message: 'Unknown feed' }, 400);
  }

  const limit = Math.min(parseInt(c.req.query('limit') ?? '30', 10), 100);
  const cursor = c.req.query('cursor') ?? undefined;

  // Extract requesting user's DID from JWT (Authorization: Bearer <jwt>)
  const authHeader = c.req.header('Authorization');
  let requesterDid: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    try {
      // Decode JWT payload without verification (AppView already verified)
      const token = authHeader.slice(7);
      const payloadB64 = token.split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      requesterDid = payload.iss;
    } catch {
      // Ignore JWT parse errors — treat as unauthenticated
    }
  }

  // If we have a requester DID, look up their matches
  if (requesterDid) {
    const user = await getTrackUserByDid(requesterDid);
    if (user) {
      const matches = await getFeedSkeletonMatches(requesterDid, limit, cursor);
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        return c.json({
          cursor: lastMatch.matched_at,
          feed: matches.map((m) => ({ post: m.post_uri })),
        });
      }
    }
  }

  // No matches or unauthenticated — return explainer post if configured
  if (FEED_EXPLAINER_URI) {
    return c.json({ feed: [{ post: FEED_EXPLAINER_URI }] });
  }

  return c.json({ feed: [] });
});

// ─── Observability ──────────────────────────────────────────────────────────

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

// ─── Auth wall ──────────────────────────────────────────────────────────────
app.use('/*', trackSessionRequired as never);

// ─── Dashboard ──────────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const userId = c.get('userId');
  const user = await getTrackUserById(userId);
  const tracks = await getTracksByUserId(userId);
  const counts = await getMatchCountByTrack(userId);
  const countMap = new Map(counts.map((r) => [r.track_id, parseInt(r.count, 10)]));

  return c.html(renderPage('Dashboard', user?.handle ?? '', `
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-xl font-semibold text-slate-800">Your Tracks</h2>
      <button onclick="document.getElementById('new-track-form').classList.toggle('hidden')"
        class="px-4 py-2 bg-gradient-to-r from-blue-500 to-emerald-500 text-white text-sm font-medium rounded-lg hover:from-blue-600 hover:to-emerald-600 transition-all shadow-sm cursor-pointer">
        + New Track
      </button>
    </div>

    <form id="new-track-form" method="POST" action="/tracks" class="hidden mb-6 p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Name</label>
        <input type="text" name="name" placeholder="e.g. AI Research" required
          class="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Search Query</label>
        <input type="text" name="query" placeholder="e.g. artificial intelligence breakthroughs and their impact on society" required
          class="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        <p class="text-xs text-slate-400 mt-1">Describe what you want to find in natural language. Uses semantic AI matching.</p>
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Boost Keywords <span class="text-slate-400">(optional)</span></label>
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
          if (v && !tags.includes(v)) { tags.push(v); render(); }
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
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Squelch <span class="text-slate-400" id="squelch-val">(0.70)</span></label>
        <input type="range" name="threshold" min="0" max="1" step="0.01" value="0.70"
          class="w-full accent-blue-500" oninput="document.getElementById('squelch-val').textContent='('+parseFloat(this.value).toFixed(2)+')'">
        <p class="text-xs text-slate-400 mt-1">Lower = more matches, higher = stricter semantic relevance.</p>
      </div>
      <button type="submit"
        class="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-emerald-500 text-white text-sm font-medium rounded-lg hover:from-blue-600 hover:to-emerald-600 transition-all cursor-pointer">
        Create Track
      </button>
    </form>

    ${tracks.length === 0 ? '<p class="text-slate-400 text-sm">No tracks yet. Create one to start monitoring Bluesky posts.</p>' : ''}

    <div class="space-y-3">
      ${tracks.map((t) => `
        <div class="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-sm transition-shadow">
          <div class="flex justify-between items-center">
            <div class="flex items-center gap-2">
              <a href="/tracks/${t.id}" class="font-semibold text-slate-800 hover:text-blue-600 transition-colors no-underline">${escHtml(t.name)}</a>
              ${t.is_active ? '<span class="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">Active</span>' : '<span class="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">Paused</span>'}
            </div>
            <span class="text-xs font-medium bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full">${countMap.get(String(t.id)) ?? 0} matches</span>
          </div>
          <div class="mt-2 text-sm text-slate-500">
            ${t.query ? `<span class="italic">&ldquo;${escHtml(t.query)}&rdquo;</span>` : ''}
            ${t.keywords.length > 0 ? `<span class="${t.query ? 'ml-2' : ''}">Keywords: ${t.keywords.map((k) => `<code class="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-xs font-medium">${escHtml(k)}</code>`).join(' ')}</span>` : ''}
          </div>
          <div class="mt-3 flex items-center gap-4 text-xs">
            <a href="/rss/${t.feed_token}" target="_blank" class="text-blue-500 hover:text-blue-700 transition-colors">RSS Feed</a>
            <a href="/tracks/${t.id}/edit" class="text-slate-500 hover:text-blue-600 transition-colors">Edit</a>
            <form method="POST" action="/tracks/${t.id}/toggle" class="inline">
              <button type="submit" class="${t.is_active ? 'text-amber-500 hover:text-amber-700' : 'text-emerald-500 hover:text-emerald-700'} transition-colors cursor-pointer">${t.is_active ? 'Pause' : 'Resume'}</button>
            </form>
            <form method="POST" action="/tracks/${t.id}/delete" class="inline">
              <button type="submit" class="text-red-400 hover:text-red-600 transition-colors cursor-pointer" onclick="return confirm('Delete this track?')">Delete</button>
            </form>
          </div>
        </div>
      `).join('')}
    </div>
  `));
});

// ─── Track CRUD ─────────────────────────────────────────────────────────────

app.post('/tracks', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.parseBody();
  const name = String(body.name ?? '').trim();
  const query = String(body.query ?? '').trim();
  const keywordsRaw = String(body.keywords ?? '').trim();

  if (!name || !query) return c.redirect('/');

  const keywords = keywordsRaw ? keywordsRaw.split(',').map((k) => k.trim()).filter(Boolean) : [];
  const threshold = parseFloat(String(body.threshold ?? '0.7'));

  const track = await createTrack(userId, name, keywords, '', query, isNaN(threshold) ? 0.7 : threshold);
  const osQueryId = await upsertTrackQuery(track.id, keywords);
  await updateTrackKeywords(track.id, keywords, osQueryId);

  // Embed the semantic query and store for worker matching
  try {
    const queryEmbedding = await embedText(query);
    await updateTrackQueryEmbedding(track.id, queryEmbedding);
  } catch (err) {
    logger.error({ err }, 'Failed to embed query — track created without semantic matching');
  }

  return c.redirect('/');
});

app.post('/tracks/:id/toggle', async (c) => {
  const userId = c.get('userId');
  const trackId = parseInt(c.req.param('id'), 10);
  const track = await getTrackById(trackId);
  if (!track || String(track.user_id) !== String(userId)) return c.text('Not found', 404);

  await toggleTrackActive(trackId);
  return c.redirect('/');
});

// ─── Track Edit ─────────────────────────────────────────────────────────────

app.get('/tracks/:id/edit', async (c) => {
  const userId = c.get('userId');
  const trackId = parseInt(c.req.param('id'), 10);
  const track = await getTrackById(trackId);
  if (!track || String(track.user_id) !== String(userId)) return c.text('Not found', 404);
  const user = await getTrackUserById(userId);

  return c.html(renderPage('Edit Track', user?.handle ?? '', `
    <div class="mb-6">
      <a href="/" class="text-sm text-blue-500 hover:text-blue-700 transition-colors no-underline">&larr; Back to Dashboard</a>
    </div>
    <h2 class="text-xl font-semibold text-slate-800 mb-6">Edit: ${escHtml(track.name)}</h2>
    <form method="POST" action="/tracks/${track.id}/edit" class="space-y-4 bg-slate-50 border border-slate-200 rounded-xl p-5">
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Name</label>
        <input type="text" name="name" value="${escHtml(track.name)}" required
          class="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Search Query</label>
        <input type="text" name="query" value="${escHtml(track.query ?? '')}" required
          class="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        <p class="text-xs text-slate-400 mt-1">Describe what you want to find in natural language.</p>
      </div>
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Boost Keywords <span class="text-slate-400">(optional)</span></label>
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
          if (v && !tags.includes(v)) { tags.push(v); render(); }
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
      <div>
        <label class="block text-xs font-medium text-slate-500 mb-1">Squelch <span class="text-slate-400" id="edit-squelch-val">(${track.threshold.toFixed(2)})</span></label>
        <input type="range" name="threshold" min="0" max="1" step="0.01" value="${track.threshold.toFixed(2)}"
          class="w-full accent-blue-500" oninput="document.getElementById('edit-squelch-val').textContent='('+parseFloat(this.value).toFixed(2)+')'">
        <p class="text-xs text-slate-400 mt-1">Lower = more matches, higher = stricter semantic relevance.</p>
      </div>
      <button type="submit"
        class="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-emerald-500 text-white text-sm font-medium rounded-lg hover:from-blue-600 hover:to-emerald-600 transition-all cursor-pointer">
        Save Changes
      </button>
    </form>
  `));
});

app.post('/tracks/:id/edit', async (c) => {
  const userId = c.get('userId');
  const trackId = parseInt(c.req.param('id'), 10);
  const track = await getTrackById(trackId);
  if (!track || String(track.user_id) !== String(userId)) return c.text('Not found', 404);

  const body = await c.req.parseBody();
  const name = String(body.name ?? '').trim();
  const query = String(body.query ?? '').trim();
  const keywordsRaw = String(body.keywords ?? '').trim();
  const threshold = parseFloat(String(body.threshold ?? '0.7'));
  const keywords = keywordsRaw ? keywordsRaw.split(',').map((k) => k.trim()).filter(Boolean) : [];

  if (!name || !query) return c.redirect(`/tracks/${trackId}/edit`);

  await updateTrack(trackId, { name, query, keywords, threshold: isNaN(threshold) ? 0.7 : threshold });

  // Re-upsert OpenSearch percolate query
  const osQueryId = await upsertTrackQuery(trackId, keywords);
  await updateTrackKeywords(trackId, keywords, osQueryId);

  // Re-embed the query if it changed
  if (query !== track.query) {
    try {
      const queryEmbedding = await embedText(query);
      await updateTrackQueryEmbedding(trackId, queryEmbedding);
    } catch (err) {
      logger.error({ err }, 'Failed to re-embed query');
    }
  }

  return c.redirect('/');
});

app.post('/tracks/:id/delete', async (c) => {
  const userId = c.get('userId');
  const trackId = parseInt(c.req.param('id'), 10);
  const track = await getTrackById(trackId);
  if (!track || String(track.user_id) !== String(userId)) return c.text('Not found', 404);

  await deleteTrackQuery(track.id);
  await dbDeleteTrack(track.id);
  return c.redirect('/');
});

// ─── Track Feed ─────────────────────────────────────────────────────────────

app.get('/tracks/:id', async (c) => {
  const userId = c.get('userId');
  const trackId = parseInt(c.req.param('id'), 10);
  const track = await getTrackById(trackId);
  if (!track || track.user_id !== userId) return c.text('Not found', 404);

  const user = await getTrackUserById(userId);
  const before = c.req.query('before');
  const matches = await getMatchesByTrackId(track.id, 50, before);

  return c.html(renderPage(track.name, user?.handle ?? '', `
    <div class="flex justify-between items-center mb-6">
      <div>
        <a href="/" class="text-sm text-blue-500 hover:text-blue-700 transition-colors">← Back</a>
        <h2 class="text-xl font-semibold text-slate-800 mt-1">${escHtml(track.name)}</h2>
        <div class="text-sm text-slate-500 mt-1">
          Keywords: ${track.keywords.map((k) => `<code class="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-xs font-medium">${escHtml(k)}</code>`).join(' ')}
        </div>
      </div>
      <a href="/rss/${track.feed_token}" target="_blank"
        class="px-3 py-1.5 border border-slate-200 text-slate-500 text-sm rounded-lg hover:border-blue-500 hover:text-blue-500 transition-colors no-underline">RSS</a>
    </div>
    ${renderMatches(matches)}
    ${matches.length === 50 ? `<a href="/tracks/${track.id}?before=${matches[matches.length - 1].matched_at.toISOString()}" class="block text-center mt-4 py-2.5 border border-slate-200 text-slate-500 text-sm rounded-lg hover:border-blue-500 hover:text-blue-500 transition-colors no-underline">Load more</a>` : ''}
  `));
});

app.get('/feed', async (c) => {
  const userId = c.get('userId');
  const user = await getTrackUserById(userId);
  const before = c.req.query('before');
  const matches = await getMatchesByUserId(userId, 50, before);

  return c.html(renderPage('All Matches', user?.handle ?? '', `
    <h2 class="text-xl font-semibold text-slate-800 mb-6">All Matches</h2>
    ${renderMatches(matches)}
    ${matches.length === 50 ? `<a href="/feed?before=${matches[matches.length - 1].matched_at.toISOString()}" class="block text-center mt-4 py-2.5 border border-slate-200 text-slate-500 text-sm rounded-lg hover:border-blue-500 hover:text-blue-500 transition-colors no-underline">Load more</a>` : ''}
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
}

function renderMatches(matches: MatchRow[]): string {
  if (matches.length === 0) return '<p class="text-slate-400 text-sm">No matches yet.</p>';
  return `<div class="space-y-2">${matches.map((m) => {
    const bskyUrl = m.post_uri.replace('at://', 'https://bsky.app/profile/').replace('/app.bsky.feed.post/', '/post/');
    const ago = timeAgo(m.matched_at);
    return `
      <div class="bg-white border border-slate-200 rounded-xl p-4 hover:shadow-sm transition-shadow">
        <div class="text-xs text-slate-400 mb-1.5">
          ${m.track_name ? `<span class="bg-gradient-to-r from-blue-500 to-emerald-500 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-full">${escHtml(m.track_name)}</span> · ` : ''}
          <a href="https://bsky.app/profile/${m.post_did}" target="_blank" class="text-slate-400 hover:text-blue-500 transition-colors">${m.post_did.slice(0, 24)}…</a> · ${ago}
        </div>
        <div class="text-sm text-slate-700 leading-relaxed">${escHtml(m.post_text)}</div>
        <a href="${bskyUrl}" target="_blank" class="text-xs text-blue-500 hover:text-blue-700 mt-2 inline-block transition-colors">View on Bluesky →</a>
      </div>`;
  }).join('')}</div>`;
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
    return `<item>
      <title>${escHtml(m.post_text.slice(0, 100))}</title>
      <link>${bskyUrl}</link>
      <description>${escHtml(m.post_text)}</description>
      <pubDate>${m.matched_at.toUTCString()}</pubDate>
      <guid>${m.post_uri}</guid>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Track: ${escHtml(title)}</title>
    <description>Bluesky posts matching "${escHtml(title)}"</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;
}

function renderPage(title: string, handle: string, content: string): string {
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
</head>
<body class="bg-slate-50 font-[Inter] text-slate-800 min-h-screen">
  <nav class="bg-white border-b border-slate-200 sticky top-0 z-10">
    <div class="max-w-3xl mx-auto px-4 flex justify-between items-center h-14">
      <a href="/" class="flex items-center gap-2 no-underline">
        <img src="/logo.png" alt="Track" class="h-7">
      </a>
      <div class="flex items-center gap-4">
        <a href="/feed" class="text-sm text-slate-500 hover:text-blue-500 transition-colors no-underline">All Matches</a>
        <span class="text-xs text-slate-400">@${escHtml(handle)}</span>
        <form method="POST" action="/oauth/logout" class="inline">
          <button type="submit" class="text-xs text-slate-400 hover:text-red-500 transition-colors cursor-pointer">Logout</button>
        </form>
      </div>
    </div>
  </nav>
  <main class="max-w-3xl mx-auto px-4 py-8">
    ${content}
  </main>
</body>
</html>`;
}

// ─── Start ──────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: TRACK_PORT }, () => {
  logger.info({ port: TRACK_PORT }, 'Track web server started');
});

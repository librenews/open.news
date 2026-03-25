import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { getCookie } from 'hono/cookie';
import { createHmac } from 'crypto';
import { logger } from '../lib/logger.js';
import {
  createTrack, getTracksByUserId, getTrackById, getTrackByFeedToken,
  deleteTrack as dbDeleteTrack, updateTrackKeywords, updateTrackQueryEmbedding,
  getMatchesByTrackId, getMatchesByUserId, getMatchCountByTrack,
} from '../db/queries/tracks.js';
import { upsertTrackQuery, deleteTrackQuery } from './opensearch.js';
import { embedText } from './embedClient.js';
import { trackAuthRouter, getTrackUserById } from './auth.js';
import { createMiddleware } from 'hono/factory';

const TRACK_PORT = Number(process.env.TRACK_PORT ?? 4200);
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-secret';

type Env = { Variables: { userId: bigint } };
const app = new Hono<Env>();

// ─── Static files ───────────────────────────────────────────────────────────
app.use('/*', serveStatic({ root: './src/track/public' }));

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
        <label class="block text-xs font-medium text-slate-500 mb-1">Boost Keywords <span class="text-slate-400">(optional, comma-separated)</span></label>
        <input type="text" name="keywords" placeholder="GPT, LLM, neural network"
          class="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        <p class="text-xs text-slate-400 mt-1">Exact keyword matches boost ranking alongside semantic search.</p>
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
            <a href="/tracks/${t.id}" class="font-semibold text-slate-800 hover:text-blue-600 transition-colors no-underline">${escHtml(t.name)}</a>
            <span class="text-xs font-medium bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full">${countMap.get(String(t.id)) ?? 0} matches</span>
          </div>
          <div class="mt-2 text-sm text-slate-500">
            ${t.query ? `<span class="italic">&ldquo;${escHtml(t.query)}&rdquo;</span>` : ''}
            ${t.keywords.length > 0 ? `<span class="${t.query ? 'ml-2' : ''}">Keywords: ${t.keywords.map((k) => `<code class="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-xs font-medium">${escHtml(k)}</code>`).join(' ')}</span>` : ''}
          </div>
          <div class="mt-3 flex items-center gap-4 text-xs">
            <a href="/rss/${t.feed_token}" target="_blank" class="text-blue-500 hover:text-blue-700 transition-colors">RSS Feed</a>
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

  const track = await createTrack(userId, name, keywords, '', query);
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

app.post('/tracks/:id/delete', async (c) => {
  const userId = c.get('userId');
  const trackId = parseInt(c.req.param('id'), 10);
  const track = await getTrackById(trackId);
  if (!track || track.user_id !== userId) return c.text('Not found', 404);

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

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { createHmac } from 'crypto';
import { logger } from '../lib/logger.js';
import { feedsAuthRouter, getOAuthClient, getAgent } from './auth.js';
import { getFeedUserById, createCustomFeed, getCustomFeedByUuid, getCustomFeedsByOwner, updateCustomFeedBskyUri, deleteCustomFeed } from './db.js';
import type { FeedUser, CustomFeed } from './db.js';
import { upsertTrackQuery, searchMediaContent } from '../track/opensearch.js';
import { db } from '../db/client.js';
import { embedText } from '../track/embedClient.js';
import { getCachedProfile, getCachedProfiles } from '../lib/pdsCache.js';
import { isLeafletContent, renderLeafletHtml, renderContent } from '../blogs/lib/contentRenderer.js';
import { registerSubscriber } from './rssCloud.js';
import { generateRssFeed, leafletToMarkdown, postToHtml, getPostImageUrl, escapeXml, formatEmbedHtml, formatEmbedMarkdown } from './rss.js';
import type { RssFeedItem } from './rss.js';

type Variables = { userId: bigint };

const app = new Hono<{ Variables: Variables }>();
const FEEDS_PORT = parseInt(process.env.FEEDS_PORT ?? '4300', 10);
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-secret';
const FEEDS_BASE_URL = process.env.FEEDS_BASE_URL ?? 'http://localhost:4300';
const FEEDS_DID = process.env.FEEDS_DID ?? 'did:web:track.social';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

app.route('/', feedsAuthRouter);

// ─── Favicon ────────────────────────────────────────────────────────────────
app.get('/favicon.png', async (c) => {
  const { readFile } = await import('fs/promises');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const buf = await readFile(join(__dirname, 'favicon.png'));
  return new Response(buf, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
});

// ─── DID Document (so did:web:feeds.social resolves to this server) ─────────
app.get('/.well-known/did.json', (c) => {
  return c.json({
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: 'did:web:feeds.social',
    service: [
      {
        id: '#bsky_fg',
        type: 'BskyFeedGenerator',
        serviceEndpoint: 'https://feeds.social',
      },
    ],
  });
});

// ─── Optional auth middleware (sets userId if logged in, but doesn't redirect) ─
app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/login') || c.req.path.startsWith('/oauth') || c.req.path === '/favicon.png' || c.req.path === '/client-metadata.json' || c.req.path.startsWith('/.well-known') || c.req.path.startsWith('/xrpc')) {
    return next();
  }

  const cookie = getCookie(c, 'feeds_session');
  if (cookie) {
    const [payload, sig] = cookie.split('.');
    if (payload && sig) {
      const expectedSig = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
      if (sig === expectedSig) {
        c.set('userId', BigInt(payload));
      }
    }
  }
  await next();
});

// ─── Layout ─────────────────────────────────────────────────────────────────

function renderLayout(user: FeedUser | null, content: string, title = 'feeds.social'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="Create custom Bluesky feeds from any search query. Instant, personalized news feeds powered by the AT Protocol.">
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script src="https://unpkg.com/htmx.org@1.9.12"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <style>
    html, body { height: 100%; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .fade-in { animation: fadeIn 0.3s ease-out both; }
    @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .pulse-dot { animation: pulse-dot 1.5s ease-in-out infinite; }
  </style>
</head>
<body class="bg-slate-50 font-[Inter] text-slate-800 min-h-screen flex flex-col">
  <!-- Nav -->
  <nav class="bg-white/80 backdrop-blur-lg border-b border-slate-200/60 sticky top-0 z-50">
    <div class="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
      <a href="/" class="text-lg font-extrabold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent no-underline tracking-tight">feeds.social</a>
      <div class="flex items-center gap-3">
        <a href="/user-feeds" class="text-xs font-semibold text-slate-500 hover:text-indigo-600 transition-colors no-underline">User Feeds</a>
        <span class="text-xs text-slate-400">·</span>
        ${user ? `
          <a href="/my-feeds" class="text-xs font-semibold text-slate-500 hover:text-indigo-600 transition-colors no-underline">My Feeds</a>
          <span class="text-xs text-slate-400">·</span>
          <span class="text-xs text-slate-500">${escapeHtml(user.handle)}</span>
          <form action="/oauth/logout" method="POST" class="inline">
            <button type="submit" class="text-xs text-slate-400 hover:text-red-500 transition-colors cursor-pointer">Logout</button>
          </form>
        ` : `
          <a href="/login" class="text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-3 py-1.5 rounded-lg transition-colors no-underline">Sign in</a>
        `}
      </div>
    </div>
  </nav>

  <!-- Content -->
  <main class="flex-1">
    ${content}
  </main>

  <!-- Footer -->
  <footer class="text-center py-6 text-xs text-slate-400">
    Powered by the <a href="https://atproto.com" class="text-indigo-400 hover:text-indigo-600 transition-colors no-underline">AT Protocol</a>
  </footer>
</body>
</html>`;
}

// ─── Home / Search ──────────────────────────────────────────────────────────

// ─── Home / Search ──────────────────────────────────────────────────────────

function renderVideoCard(hit: any, profiles: Map<string, any>): string {
  const source = hit._source;
  const did = source.did;
  const profile = profiles.get(did) || { handle: did, displayName: did, avatar: '' };
  
  const text = (source.post_text ?? '').slice(0, 280);
  const transcript = source.transcript || '';
  const date = source.created_at
    ? new Date(source.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  const rkey = source.uri.split('/').pop() || '';
  const postUrl = `https://bsky.app/profile/${profile.handle}/post/${rkey}`;

  const hasAudio = transcript !== 'silent' && transcript !== '';

  return `
    <div class="bg-white rounded-2xl border border-slate-200 p-5 hover:border-indigo-300 transition-all hover:shadow-sm fade-in mb-4">
      <div class="flex items-start gap-4">
        <!-- Author Profile -->
        ${profile.avatar ? `<img src="${escapeHtml(profile.avatar)}" class="w-10 h-10 rounded-full shrink-0" alt="">` : '<div class="w-10 h-10 rounded-full bg-slate-200 shrink-0 flex items-center justify-center font-bold text-slate-400">?</div>'}
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between mb-2">
            <div>
              <span class="text-sm font-bold text-slate-800">${escapeHtml(profile.displayName || profile.handle)}</span>
              <span class="text-xs text-slate-400 ml-1">@${escapeHtml(profile.handle)}</span>
            </div>
            <span class="text-[11px] text-slate-400">${date}</span>
          </div>

          <!-- Post text -->
          ${text ? `<p class="text-sm text-slate-600 mb-3 leading-relaxed">${escapeHtml(text)}</p>` : ''}

          <!-- Video Player (direct PDS stream) -->
          ${source.source_url ? `
            <div class="mb-4 rounded-xl overflow-hidden bg-black aspect-video max-w-md border border-slate-100 shadow-inner">
              <video src="${escapeHtml(source.source_url)}" controls preload="none" class="w-full h-full object-contain"></video>
            </div>
          ` : ''}

          <!-- Transcript Block -->
          ${hasAudio ? `
            <div class="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3.5 mb-2">
              <div class="flex items-center justify-between mb-2 text-[10px] text-indigo-500 font-bold uppercase tracking-wider">
                <span>🎤 Transcript (${source.language ?? 'en'})</span>
                ${source.duration_ms ? `<span>⏱ ${Math.round(source.duration_ms / 1000)}s</span>` : ''}
              </div>
              <p class="text-xs text-slate-700 italic leading-relaxed">"${escapeHtml(transcript)}"</p>
            </div>
          ` : `
            <div class="bg-slate-50 border border-slate-100 rounded-xl p-2.5 mb-2 text-center text-xs text-slate-400">
              🔇 Silent video / No audio stream detected
            </div>
          `}

          <!-- Footer Actions -->
          <div class="flex items-center justify-between mt-3 text-xs">
            <a href="${postUrl}" target="_blank" rel="noopener" class="text-indigo-600 hover:text-indigo-700 font-semibold no-underline flex items-center gap-1">
              View on Bluesky ↗
            </a>
            ${source.alt_text ? `<span class="text-[11px] text-slate-400 max-w-xs truncate" title="${escapeHtml(source.alt_text)}">Alt: "${escapeHtml(source.alt_text)}"</span>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

async function getTrendingTerms(limit = 8): Promise<string[]> {
  try {
    const { rows } = await db.query<{ word: string }>(`
      SELECT word, count(*) as count
      FROM (
        SELECT regexp_replace(regexp_split_to_table(lower(text), '\\s+'), '[^a-z]', '', 'g') as word
        FROM media_transcripts
        WHERE created_at > NOW() - INTERVAL '48 hours'
      ) words
      WHERE length(word) > 4
        AND word NOT IN (
          'about', 'above', 'after', 'again', 'against', 'along', 'among', 'around', 
          'because', 'before', 'being', 'below', 'between', 'could', 'didnt', 'doesnt', 
          'doing', 'during', 'either', 'first', 'going', 'great', 'havent', 'having', 
          'house', 'inside', 'might', 'never', 'other', 'people', 'really', 'should', 
          'since', 'their', 'there', 'these', 'thing', 'think', 'those', 'through', 
          'under', 'until', 'where', 'which', 'while', 'would', 'years', 'youre', 
          'about', 'every', 'would', 'something', 'about', 'right', 'doing', 'where', 
          'about', 'wants', 'being', 'better', 'where', 'another'
        )
      GROUP BY word
      ORDER BY count DESC
      LIMIT $1
    `, [limit]);
    return rows.map(r => r.word);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch trending video terms');
    return [];
  }
}

async function renderVideoEmptyState(): Promise<string> {
  const trending = await getTrendingTerms(6);
  
  // Fetch latest 5 non-silent videos to display as a discovery feed
  let hits: any[] = [];
  let profiles = new Map<string, any>();
  try {
    const os = getOsClient();
    const latestRes = await os.search({
      index: MEDIA_INDEX,
      body: {
        size: 5,
        query: {
          bool: {
            must_not: [
              { term: { transcript: 'silent' } }
            ]
          }
        },
        sort: [
          { created_at: { order: 'desc' } }
        ]
      }
    });
    hits = latestRes.body.hits?.hits ?? [];
    const authorDids = [...new Set(hits.map((h: any) => h._source.did))] as string[];
    profiles = await getCachedProfiles(authorDids);
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch discovery feed');
  }

  const categories = [
    { name: 'Politics', query: 'election trump harris biden senate vote government', emoji: '🏛️', bg: 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200' },
    { name: 'Tech & AI', query: 'ai technology software robot computer developer coding coding chatgpt nvidia', emoji: '💻', bg: 'bg-sky-50 hover:bg-sky-100 text-sky-700 border-sky-200' },
    { name: 'Finance & Business', query: 'inflation stocks business economy finance dollars crypto bitcoin money tax', emoji: '📈', bg: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200' },
    { name: 'Science & Nature', query: 'science nature space nasa planet trail hiking animal bird climate weather', emoji: '🌿', bg: 'bg-lime-50 hover:bg-lime-100 text-lime-700 border-lime-200' },
    { name: 'Entertainment', query: 'game gaming nintendo pokemon anime music song movie show actor', emoji: '🎮', bg: 'bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200' },
    { name: 'Humor & Memes', query: 'funny meme joke comedy laugh fail dog cat puppy', emoji: '✨', bg: 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200' },
  ];

  return `
    <div class="space-y-12">
      <!-- Browse by Smart Category -->
      <div>
        <h2 class="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 text-center">Smart Categories</h2>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
          ${categories.map(cat => `
            <a href="/?q=${encodeURIComponent(cat.query)}&type=video&category_name=${encodeURIComponent(cat.name)}" class="${cat.bg} border rounded-2xl p-4 text-center no-underline transition-all hover:scale-[1.02] active:scale-[0.98] shadow-sm flex flex-col items-center justify-center gap-1">
              <span class="text-2xl">${cat.emoji}</span>
              <span class="text-sm font-bold">${cat.name}</span>
            </a>
          `).join('')}
        </div>
      </div>

      <!-- Trending Topics -->
      ${trending.length > 0 ? `
      <div>
        <h2 class="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 text-center">📈 Trending in Videos</h2>
        <div class="flex flex-wrap gap-2 justify-center max-w-2xl mx-auto">
          ${trending.map(term => `
            <a href="/?q=${encodeURIComponent(term)}&type=video" class="bg-indigo-50/50 hover:bg-indigo-100/80 text-indigo-700 border border-indigo-100/60 rounded-xl px-4 py-2 text-sm font-semibold transition-all no-underline">
              #${escapeHtml(term)}
            </a>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Discovery Feed (Latest Videos) -->
      ${hits.length > 0 ? `
      <div>
        <h2 class="text-sm font-bold text-slate-400 uppercase tracking-wider mb-6 text-center">📺 Freshly Transcribed</h2>
        <div class="space-y-4 max-w-2xl mx-auto">
          ${hits.map((h: any) => renderVideoCard(h, profiles)).join('')}
        </div>
      </div>
      ` : ''}
    </div>
  `;
}

app.get('/', async (c) => {
  const userId = c.get('userId');
  const user = userId ? await getFeedUserById(userId) : null;
  const q = c.req.query('q') || '';
  const type = c.req.query('type') || 'text'; // 'text' or 'video'
  const categoryName = c.req.query('category_name') || '';

  const content = `
    <div class="max-w-4xl mx-auto px-6 ${q ? 'pt-8' : 'pt-16'} pb-12">
      ${!q ? `
      <!-- Hero -->
      <div class="text-center mb-8">
        <h1 class="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4 leading-tight">
          Create a <span class="bg-gradient-to-r from-indigo-600 to-violet-500 bg-clip-text text-transparent">custom feed</span><br>from any topic
        </h1>
        <p class="text-lg text-slate-500 max-w-lg mx-auto">
          Search for any subject and instantly generate a personalized Bluesky feed. No setup required.
        </p>
      </div>
      ` : ''}

      <!-- Tabs -->
      <div class="flex items-center justify-center gap-2 mb-8">
        <a href="/?q=${encodeURIComponent(q)}&type=text" class="px-4 py-2 rounded-xl text-sm font-semibold transition-all ${type === 'text' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'} no-underline">
          📝 All Posts
        </a>
        <a href="/?q=${encodeURIComponent(q)}&type=video" class="px-4 py-2 rounded-xl text-sm font-semibold transition-all ${type === 'video' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'} no-underline">
          🎥 Videos (Beta)
        </a>
      </div>

      <!-- Search bar -->
      <form action="/" method="GET" class="max-w-2xl mx-auto mb-12" id="search-form">
        <input type="hidden" name="type" value="${escapeHtml(type)}">
        <div class="relative group">
          <div class="absolute inset-0 bg-gradient-to-r from-indigo-500/20 to-violet-500/20 rounded-2xl blur-xl group-hover:blur-2xl transition-all opacity-0 group-hover:opacity-100"></div>
          <div class="relative flex items-center bg-white rounded-2xl border border-slate-200 shadow-lg shadow-slate-200/50 overflow-hidden transition-shadow group-hover:shadow-xl">
            <svg class="w-5 h-5 text-slate-400 ml-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
            </svg>
            <input
              type="text"
              name="q"
              value="${escapeHtml(q)}"
              placeholder="${type === 'video' ? 'Search speech spoken in videos...' : 'climate change, AI regulation, local sports...'}"
              autofocus
              class="flex-1 px-4 py-4 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none bg-transparent"
              id="search-input"
            >
            <button type="submit" class="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-semibold text-sm px-6 py-2.5 rounded-xl mr-2 transition-all cursor-pointer shadow-sm hover:shadow-md">
              Search
            </button>
          </div>
        </div>
      </form>

      <!-- Results (rendered server-side if q is present) -->
      <div id="results">
        ${q ? '' : (type === 'video' ? '<!-- video-empty-state-placeholder -->' : renderEmptyState())}
      </div>
    </div>
  `;

  if (!q) {
    if (type === 'video') {
      try {
        const videoEmptyState = await renderVideoEmptyState();
        const videoContent = content.replace('<!-- video-empty-state-placeholder -->', videoEmptyState);
        return c.html(renderLayout(user, videoContent, 'Video Search — feeds.social'));
      } catch (err) {
        logger.error({ err }, 'Failed to render video empty state');
        return c.html(renderLayout(user, content.replace('<!-- video-empty-state-placeholder -->', ''), 'Video Search — feeds.social'));
      }
    }
    return c.html(renderLayout(user, content, 'feeds.social — Create Custom Bluesky Feeds'));
  }

  // Run search
  try {
    let resultsHtml = '';
    if (type === 'video') {
      const hits = await searchMediaContent(q, 20);
      const authorDids = [...new Set(hits.map((h: any) => h._source.did))] as string[];
      const profiles = await getCachedProfiles(authorDids);

      const heading = categoryName
        ? `Category: <strong>${escapeHtml(categoryName)}</strong>`
        : `Search: "<strong>${escapeHtml(q)}</strong>"`;

      resultsHtml = hits.length > 0 ? `
        <div class="fade-in">
          <div class="flex items-center justify-between mb-6">
            <p class="text-sm text-slate-500">${hits.length} videos matching ${heading}</p>
            <button
              hx-post="/api/feeds/create"
              hx-vals='${JSON.stringify({ query: q, name: categoryName || q, feed_type: 'video' })}'
              hx-target="#create-result"
              hx-swap="innerHTML"
              hx-indicator="#create-spinner"
              class="bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-all cursor-pointer shadow-sm hover:shadow-md flex items-center gap-2"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>
              Create Video Feed
            </button>
          </div>
          <div id="create-result" class="mb-4"></div>
          <div id="create-spinner" class="htmx-indicator mb-4">
            <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm text-indigo-700 flex items-center gap-3">
              <div class="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
              Creating your video feed…
            </div>
          </div>
          <div class="space-y-4">
            ${hits.map((h: any) => renderVideoCard(h, profiles)).join('')}
          </div>
        </div>
      ` : `
        <div class="fade-in text-center py-12">
          <p class="text-slate-400 text-sm">No videos found for "<strong>${escapeHtml(q)}</strong>". Try a different search.</p>
        </div>
      `;
    } else {
      const posts = await searchBskyPosts(q, 20);
      resultsHtml = posts.length > 0 ? `
        <div class="fade-in">
          <div class="flex items-center justify-between mb-6">
            <p class="text-sm text-slate-500">${posts.length} posts for "<strong>${escapeHtml(q)}</strong>"</p>
            <button
              hx-post="/api/feeds/create"
              hx-vals='${JSON.stringify({ query: q, name: q, feed_type: 'text' })}'
              hx-target="#create-result"
              hx-swap="innerHTML"
              hx-indicator="#create-spinner"
              class="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-all cursor-pointer shadow-sm hover:shadow-md flex items-center gap-2"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>
              Create Feed
            </button>
          </div>
          <div id="create-result" class="mb-4"></div>
          <div id="create-spinner" class="htmx-indicator mb-4">
            <div class="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm text-indigo-700 flex items-center gap-3">
              <div class="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
              Creating your feed…
            </div>
          </div>
          <div class="space-y-3">
            ${posts.map(p => renderPostCard(p)).join('')}
          </div>
        </div>
      ` : `
        <div class="fade-in text-center py-12">
          <p class="text-slate-400 text-sm">No posts found for "<strong>${escapeHtml(q)}</strong>". Try a different query.</p>
        </div>
      `;
    }

    const fullContent = content.replace('<div id="results">\n        \n      </div>', `<div id="results">${resultsHtml}</div>`);
    return c.html(renderLayout(user, fullContent, `${q} — feeds.social`));
  } catch (err) {
    logger.error({ err, q }, 'Search failed');
    const errorContent = content.replace('<div id="results">\n        \n      </div>',
      '<div id="results"><p class="text-red-500 text-sm text-center">Search failed. Please try again.</p></div>');
    return c.html(renderLayout(user, errorContent));
  }
});

function renderEmptyState(): string {
  return `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl mx-auto">
      ${['Climate Change', 'AI & Tech', 'US Politics', 'Space Science', 'Cryptocurrency', 'Healthcare', 'Education', 'Renewable Energy'].map(topic => `
        <a href="/?q=${encodeURIComponent(topic)}" class="bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-xl px-4 py-3 text-sm text-slate-600 hover:text-indigo-700 font-medium text-center transition-all no-underline shadow-sm hover:shadow-md">
          ${escapeHtml(topic)}
        </a>
      `).join('')}
    </div>
    <p class="text-center text-xs text-slate-400 mt-6">Or type anything you're interested in</p>
  `;
}

// ─── Bluesky Post Search ────────────────────────────────────────────────────

interface BskyPost {
  uri: string;
  cid: string;
  author: { did: string; handle: string; displayName?: string; avatar?: string };
  record: { text: string; createdAt: string };
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
}

let _searchAgent: any = null;
let _searchAgentExpiry = 0;

async function getSearchAgent() {
  if (_searchAgent && Date.now() < _searchAgentExpiry) return _searchAgent;
  const { AtpAgent } = await import('@atproto/api');
  const handle = process.env.FEEDS_BSKY_HANDLE ?? process.env.BSKY_BOT_DID ?? process.env.TRACK_BSKY_HANDLE;
  const password = process.env.FEEDS_BSKY_PASSWORD ?? process.env.BSKY_BOT_PASSWORD ?? process.env.TRACK_BSKY_PASSWORD;
  if (!handle || !password) throw new Error('No valid Bluesky credentials configured for search agent');
  const agent = new AtpAgent({ service: 'https://bsky.social' });
  await agent.login({ identifier: handle, password });
  _searchAgent = agent;
  _searchAgentExpiry = Date.now() + 1000 * 60 * 30; // 30 min
  return agent;
}

async function searchBskyPosts(query: string, limit = 25): Promise<BskyPost[]> {
  try {
    const agent = await getSearchAgent();
    const res = await agent.app.bsky.feed.searchPosts({ q: query, limit, sort: 'top' });
    return (res.data.posts ?? []) as BskyPost[];
  } catch (err) {
    logger.error({ err, query }, 'Bluesky search failed');
    return [];
  }
}

function renderPostCard(post: BskyPost): string {
  const author = post.author;
  const text = (post.record?.text ?? '').slice(0, 280);
  const date = post.record?.createdAt
    ? new Date(post.record.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
  const likes = post.likeCount ?? 0;
  const reposts = post.repostCount ?? 0;
  const postUrl = `https://bsky.app/profile/${author.handle}/post/${post.uri.split('/').pop()}`;

  return `
    <a href="${postUrl}" target="_blank" rel="noopener" class="block bg-white rounded-xl border border-slate-200 hover:border-indigo-300 p-4 transition-all hover:shadow-sm no-underline group">
      <div class="flex items-start gap-3">
        ${author.avatar ? `<img src="${escapeHtml(author.avatar)}" class="w-9 h-9 rounded-full shrink-0" alt="">` : '<div class="w-9 h-9 rounded-full bg-slate-200 shrink-0"></div>'}
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm font-bold text-slate-800 group-hover:text-indigo-700 transition-colors">${escapeHtml(author.displayName || author.handle)}</span>
            <span class="text-[11px] text-slate-400">@${escapeHtml(author.handle)}</span>
            ${date ? `<span class="text-[11px] text-slate-400">· ${date}</span>` : ''}
          </div>
          <p class="text-sm text-slate-600 leading-relaxed mb-2">${escapeHtml(text)}</p>
          <div class="flex items-center gap-4 text-[11px] text-slate-400">
            ${likes > 0 ? `<span>♥ ${likes}</span>` : ''}
            ${reposts > 0 ? `<span>⟳ ${reposts}</span>` : ''}
          </div>
        </div>
      </div>
    </a>
  `;
}

// ─── Create Feed API ────────────────────────────────────────────────────────

app.post('/api/feeds/create', async (c) => {
  const userId = c.get('userId');
  const user = userId ? await getFeedUserById(userId) : null;

  const body = await c.req.parseBody();
  const query = String(body.query || '').trim();
  const name = String(body.name || query).trim();
  const feedType = String(body.feed_type || 'text').trim();

  if (!query) {
    return c.html('<div class="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">Please provide a search query.</div>');
  }

  try {
    let seedUris: string[] = [];
    if (feedType === 'video') {
      // Search media content index for seed posts
      const hits = await searchMediaContent(query, 30);
      seedUris = hits.map((h: any) => h._source.uri);
    } else {
      // Search standard Bluesky posts
      const posts = await searchBskyPosts(query, 30);
      seedUris = posts.map(p => p.uri);
    }

    // 2. Create custom_feeds row
    const feed = await createCustomFeed({
      owner_id: user?.id ?? null,
      name,
      query,
      description: `Custom ${feedType === 'video' ? 'video ' : ''}feed: ${name}`,
      seed_uris: seedUris,
      feed_type: feedType,
    });

    let trackId: number | null = null;

    // 3. Create a corresponding track row so the worker starts percolating (only for text feeds)
    if (feedType !== 'video') {
      const keywords = query.split(/\s+/).filter(k => k.length > 2);
      let osQueryId = '';
      try {
        // Use a dedicated percolate doc ID prefix to keep them identifiable
        osQueryId = await upsertTrackQuery(feed.id, keywords);
      } catch (err) {
        logger.warn({ err, feedId: feed.id }, 'OpenSearch percolate upsert failed (non-fatal)');
      }

      // Create a linked track row for the worker to pick up
      const { rows: trackRows } = await db.query(
        `INSERT INTO tracks (user_id, name, keywords, os_query_id, query, threshold, uuid)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          1, // system user in track_users
          name,
          keywords,
          osQueryId,
          query,
          0.70,
          feed.uuid, // same UUID so feed skeleton can resolve
        ]
      );
      if (trackRows[0]) {
        trackId = trackRows[0].id;
      }

      // 4. Embed the query for semantic matching
      try {
        const embedding = await embedText(query);
        if (embedding && trackId) {
          await db.query(
            'UPDATE tracks SET query_embedding = $1 WHERE id = $2',
            [JSON.stringify(embedding), trackId]
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Embed failed (non-fatal)');
      }
    }

    // 5. Publish to Bluesky PDS
    let bskyUri = '';
    let publishedHandle = process.env.FEEDS_BSKY_HANDLE ?? process.env.BSKY_BOT_DID ?? process.env.TRACK_BSKY_HANDLE ?? 'feeds.social';
    const feedDescription = feedType === 'video'
      ? `Custom video feed searching: "${name}"`
      : `Custom feed: ${name}`;

    try {
      if (user) {
        // Signed-in user: publish to THEIR PDS so the feed shows "By @theirhandle"
        const userAgent = await getAgent(user.did);
        const res = await userAgent.com.atproto.repo.putRecord({
          repo: user.did,
          collection: 'app.bsky.feed.generator',
          rkey: feed.uuid,
          record: {
            did: FEEDS_DID,
            displayName: name.length > 24 ? name.slice(0, 24) : name,
            description: feedDescription,
            createdAt: new Date().toISOString(),
          },
        });
        bskyUri = res.data.uri;
        publishedHandle = user.handle;
      } else {
        // Anonymous: publish under the feeds.social account
        const { AtpAgent } = await import('@atproto/api');
        const handle = process.env.FEEDS_BSKY_HANDLE ?? process.env.BSKY_BOT_DID ?? process.env.TRACK_BSKY_HANDLE;
        const password = process.env.FEEDS_BSKY_PASSWORD ?? process.env.BSKY_BOT_PASSWORD ?? process.env.TRACK_BSKY_PASSWORD;
        if (handle && password) {
          const agent = new AtpAgent({ service: 'https://bsky.social' });
          await agent.login({ identifier: handle, password });
          const res = await agent.com.atproto.repo.putRecord({
            repo: agent.session!.did,
            collection: 'app.bsky.feed.generator',
            rkey: feed.uuid,
            record: {
              did: FEEDS_DID,
              displayName: name.length > 24 ? name.slice(0, 24) : name,
              description: feedDescription,
              createdAt: new Date().toISOString(),
            },
          });
          bskyUri = res.data.uri;
        }
      }

      if (bskyUri) {
        await updateCustomFeedBskyUri(feed.id, bskyUri);
        if (trackId) {
          await db.query('UPDATE tracks SET feed_published = true WHERE id = $1', [trackId]);
        }
      }
    } catch (err) {
      logger.error({ err, uuid: feed.uuid }, 'Failed to publish feed to Bluesky');
    }

    // 6. Build the bsky.app URL for the feed
    const bskyAppUrl = bskyUri
      ? `https://bsky.app/profile/${publishedHandle}/feed/${feed.uuid}`
      : null;

    logger.info({ feedId: feed.id, uuid: feed.uuid, name, seedCount: seedUris.length, bskyUri }, 'Custom feed created');

    return c.html(`
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-5 fade-in">
        <div class="flex items-start gap-3">
          <div class="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
          </div>
          <div>
            <p class="text-sm font-bold text-emerald-800 mb-1">Feed created: ${escapeHtml(name)}</p>
            <p class="text-xs text-emerald-600 mb-3">${feedType === 'video' ? 'Dynamic video search feed created.' : `Seeded with ${seedUris.length} posts. New matches will be added automatically.`}</p>
            ${bskyAppUrl ? `
              <a href="${bskyAppUrl}" target="_blank" rel="noopener" class="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-all no-underline shadow-sm hover:shadow-md">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                Open in Bluesky
              </a>
            ` : '<p class="text-xs text-amber-600">Feed created locally but Bluesky publishing failed. Try signing in first.</p>'}
          </div>
        </div>
      </div>
    `);
  } catch (err) {
    logger.error({ err, query }, 'Create feed failed');
    return c.html(`<div class="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">Failed to create feed: ${escapeHtml((err as Error).message)}</div>`);
  }
});

// ─── My Feeds ───────────────────────────────────────────────────────────────

app.get('/my-feeds', async (c) => {
  const userId = c.get('userId');
  const user = userId ? await getFeedUserById(userId) : null;
  if (!user) return c.redirect('/login');

  const feeds = await getCustomFeedsByOwner(user.id);

  const feedCards = feeds.length > 0 ? feeds.map(f => {
    const bskyAppUrl = f.bsky_uri
      ? `https://bsky.app/profile/${user.handle}/feed/${f.uuid}`
      : null;

    return `
      <div class="bg-white rounded-xl border border-slate-200 hover:border-slate-300 p-5 transition-all hover:shadow-sm fade-in" id="feed-${f.uuid}" x-data="{ confirmDelete: false }">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1">
            <h3 class="text-sm font-bold text-slate-800 mb-1">${escapeHtml(f.name)}</h3>
            <p class="text-xs text-slate-400 mb-2">Query: "${escapeHtml(f.query)}" · ${(f.seed_uris as any)?.length ?? 0} seeds</p>
            <div class="flex items-center gap-2">
              ${f.is_public ? '<span class="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full">LIVE</span>' : '<span class="bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded-full">LOCAL</span>'}
              <span class="text-[10px] text-slate-400">${new Date(f.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <a href="/feed/${f.uuid}.html" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors no-underline">
              HTML
            </a>
            <a href="/feed/${f.uuid}.rss" class="bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors no-underline">
              RSS
            </a>
            ${bskyAppUrl ? `
              <a href="${bskyAppUrl}" target="_blank" rel="noopener" class="bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors no-underline">
                Bluesky ↗
              </a>
            ` : ''}
            <button @click="confirmDelete = true" class="bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-500 p-1.5 rounded-lg transition-colors cursor-pointer" title="Delete feed">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
          </div>
        </div>

        <!-- Confirm delete modal -->
        <div x-show="confirmDelete" x-cloak class="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 fade-in">
          <p class="text-sm text-red-800 font-medium mb-1">Delete "${escapeHtml(f.name)}"?</p>
          <p class="text-xs text-red-600 mb-3">This will remove the feed from Bluesky and cannot be undone.</p>
          <div class="flex items-center gap-2">
            <button
              hx-delete="/api/feeds/${f.uuid}"
              hx-target="#feed-${f.uuid}"
              hx-swap="outerHTML"
              class="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors cursor-pointer"
            >Delete</button>
            <button @click="confirmDelete = false" class="bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium px-4 py-2 rounded-lg border border-slate-200 transition-colors cursor-pointer">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }).join('') : `
    <div class="text-center py-16">
      <p class="text-slate-400 text-sm mb-4">You haven't created any feeds yet.</p>
      <a href="/" class="bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-bold px-6 py-2.5 rounded-xl no-underline shadow-sm hover:shadow-md transition-all">Create your first feed</a>
    </div>
  `;

  const content = `
    <div class="max-w-3xl mx-auto px-6 pt-10 pb-12">
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">My Feeds</h1>
          <p class="text-sm text-slate-500 mt-1">${feeds.length} feed${feeds.length !== 1 ? 's' : ''} created</p>
        </div>
        <a href="/" class="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-all no-underline shadow-sm hover:shadow-md flex items-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"></path></svg>
          New Feed
        </a>
      </div>
      <div class="space-y-3">${feedCards}</div>
    </div>
  `;

  return c.html(renderLayout(user, content, 'My Feeds — feeds.social'));
});

// ─── Delete Feed API ────────────────────────────────────────────────────────

app.delete('/api/feeds/:uuid', async (c) => {
  const userId = c.get('userId');
  const user = userId ? await getFeedUserById(userId) : null;
  if (!user) return c.html('<p class="text-red-500 text-sm">Not authenticated.</p>', 401);

  const uuid = c.req.param('uuid');
  const feed = await getCustomFeedByUuid(uuid);
  if (!feed) return c.html('<p class="text-red-500 text-sm">Feed not found.</p>', 404);

  // Ensure the user owns this feed
  if (feed.owner_id !== user.id) {
    return c.html('<p class="text-red-500 text-sm">You don\'t own this feed.</p>', 403);
  }

  try {
    // Remove feed generator record from the user's PDS
    if (feed.bsky_uri) {
      try {
        const agent = await getAgent(user.did);
        await agent.com.atproto.repo.deleteRecord({
          repo: user.did,
          collection: 'app.bsky.feed.generator',
          rkey: uuid,
        });
        logger.info({ uuid, did: user.did }, 'Deleted feed generator from PDS');
      } catch (err) {
        logger.warn({ err, uuid }, 'Failed to delete feed generator from PDS (continuing)');
      }
    }

    // Remove from database
    await deleteCustomFeed(feed.id, uuid);

    logger.info({ uuid, feedId: feed.id, user: user.handle }, 'Custom feed deleted');

    // Return empty div so HTMX removes the card
    return c.html('');
  } catch (err) {
    logger.error({ err, uuid }, 'Delete feed failed');
    return c.html(`<p class="text-red-500 text-sm">Delete failed: ${escapeHtml((err as Error).message)}</p>`);
  }
});

// ─── Feed Skeleton (Bluesky calls this) ─────────────────────────────────────

app.get('/xrpc/app.bsky.feed.getFeedSkeleton', async (c) => {
  const feedParam = c.req.query('feed') ?? '';
  const rkeyMatch = feedParam.match(/\/app\.bsky\.feed\.generator\/([^/]+)$/);
  if (!rkeyMatch) return c.json({ error: 'UnknownFeed', message: 'Unknown feed' }, 400);

  const rkey = rkeyMatch[1];
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30', 10), 100);
  const cursor = c.req.query('cursor') ?? undefined;

  // Check custom_feeds first, then fall back to tracks table
  const feed = await getCustomFeedByUuid(rkey);
  const { rows: trackCheck } = feed
    ? { rows: [{ id: null, name: null }] }
    : await db.query<{ id: string; name: string }>(
        'SELECT id, name FROM tracks WHERE uuid = $1 AND feed_published = true',
        [rkey]
      );

  if (!feed && trackCheck.length === 0) {
    return c.json({ error: 'UnknownFeed', message: 'Feed not found' }, 404);
  }

  // Handle video search feeds dynamically via OpenSearch
  if (feed && feed.feed_type === 'video') {
    try {
      const hits = await searchMediaContent(feed.query, limit, cursor);
      if (hits.length > 0) {
        const lastDoc = hits[hits.length - 1]._source;
        return c.json({
          cursor: lastDoc.created_at,
          feed: hits.map((h: any) => ({ post: h._source.uri })),
        });
      }
      return c.json({ feed: [] });
    } catch (err) {
      logger.error({ err, uuid: rkey }, 'Failed to resolve video feed skeleton');
      return c.json({ feed: [] });
    }
  }

  // Extract requester DID from Authorization header (JWT)
  const authHeader = c.req.header('Authorization');
  let requesterDid: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      const payloadB64 = token.split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      requesterDid = payload.iss;
    } catch {}
  }

  // Log the request for analytics
  const feedName = feed?.name || trackCheck[0]?.name || rkey;
  try {
    await db.query(
      `INSERT INTO feed_requests (feed_name, requester_did, cursor_used, limit_requested)
       VALUES ($1, $2, $3, $4)`,
      [feedName, requesterDid || null, cursor || null, limit]
    );
  } catch {}

  // Get matches from track_matches
  const { rows: matches } = await db.query<{ post_uri: string; matched_at: Date }>(
    `SELECT tm.post_uri, tm.matched_at
     FROM tracks t
     JOIN track_matches tm ON tm.track_id = t.id
     WHERE t.uuid = $1
     ${cursor ? 'AND tm.matched_at < $3' : ''}
     ORDER BY tm.matched_at DESC
     LIMIT $2`,
    cursor ? [rkey, limit, cursor] : [rkey, limit]
  );

  if (matches.length > 0) {
    return c.json({
      cursor: matches[matches.length - 1].matched_at.toISOString(),
      feed: matches.map(m => ({ post: m.post_uri })),
    });
  }

  // Fall back to seed URIs (custom_feeds only)
  if (feed) {
    const seedUris = (feed.seed_uris as any) || [];
    if (Array.isArray(seedUris) && seedUris.length > 0) {
      const page = seedUris.slice(0, limit);
      return c.json({ feed: page.map((uri: string) => ({ post: uri })) });
    }
  }

  return c.json({ feed: [] });
});

app.get('/xrpc/app.bsky.feed.describeFeedGenerator', (c) => {
  return c.json({
    did: FEEDS_DID,
    feeds: [],
  });
});

// ─── RSS & RSS Cloud Endpoints ──────────────────────────────────────────────

async function resolveActor(handleOrDid: string): Promise<{ did: string; handle: string; displayName?: string; avatar?: string }> {
  if (handleOrDid.startsWith('did:')) {
    try {
      const profile = await getCachedProfile(handleOrDid);
      return { did: handleOrDid, handle: profile.handle || handleOrDid, displayName: profile.displayName, avatar: profile.avatar };
    } catch {
      return { did: handleOrDid, handle: handleOrDid };
    }
  } else {
    try {
      const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.identity.resolveHandle?handle=${encodeURIComponent(handleOrDid)}`);
      if (res.ok) {
        const data = await res.json() as any;
        if (data.did) {
          const profile = await getCachedProfile(data.did);
          return { did: data.did, handle: handleOrDid, displayName: profile.displayName, avatar: profile.avatar };
        }
      }
    } catch {}
    try {
      const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handleOrDid)}`);
      if (res.ok) {
        const data = await res.json() as any;
        if (data.did) {
          return { did: data.did, handle: data.handle || handleOrDid, displayName: data.displayName, avatar: data.avatar };
        }
      }
    } catch {}
    throw new Error(`Could not resolve actor: ${handleOrDid}`);
  }
}

async function getAuthorPosts(did: string, limit = 30): Promise<any[]> {
  try {
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(did)}&limit=${limit}`);
    if (res.ok) {
      const data = await res.json() as any;
      return data.feed || [];
    }
  } catch (err) {
    logger.error({ err, did }, 'Failed to fetch author feed from Bluesky');
  }
  return [];
}

function renderHtmlFeed(
  title: string,
  subtitle: string,
  description: string,
  rssUrl: string,
  items: any[],
  avatarUrl?: string
): string {
  const avatarHtml = avatarUrl
    ? `<img src="${escapeXml(avatarUrl)}" class="w-16 h-16 rounded-full border-2 border-indigo-500 shadow-md mr-4 shrink-0" />`
    : `<div class="w-16 h-16 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-white text-2xl font-bold shadow-md mr-4 shrink-0">${title[0].toUpperCase()}</div>`;

  const itemsHtml = items.length > 0 ? items.map(item => {
    const imageTag = item.imageUrl
      ? `<div class="mt-4 overflow-hidden rounded-xl border border-slate-100 max-h-96 flex items-center"><img src="${escapeXml(item.imageUrl)}" class="w-full h-auto object-cover" /></div>`
      : '';

    const titleTag = item.title
      ? `<h2 class="text-lg font-bold text-slate-900 group-hover:text-indigo-600 transition-colors mb-2 leading-snug">${escapeXml(item.title)}</h2>`
      : '';

    const dateStr = item.pubDate
      ? new Date(item.pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';

    return `
      <article class="group bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm hover:shadow-md transition-all duration-300">
        <a href="${escapeXml(item.link)}" target="_blank" rel="noopener" class="block no-underline">
          <div class="flex items-center justify-between text-xs text-slate-400 mb-3 font-medium">
            <span>By ${escapeXml(item.authorName)}</span>
            <span>${dateStr}</span>
          </div>
          ${titleTag}
          <div class="text-sm text-slate-600 leading-relaxed break-words">${item.description}</div>
          ${imageTag}
          <div class="mt-4 flex items-center text-xs font-semibold text-indigo-600 group-hover:text-indigo-800 transition-colors">
            Read original post / article ↗
          </div>
        </a>
      </article>
    `;
  }).join('\n') : `
    <div class="text-center py-16 bg-white rounded-2xl border border-slate-200/80 p-6">
      <p class="text-slate-400 text-sm">No posts found in this feed yet.</p>
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeXml(title)} — Feed</title>
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: 'Inter', sans-serif; }
  </style>
</head>
<body class="bg-slate-50 text-slate-800 min-h-screen">
  <div class="max-w-3xl mx-auto px-6 py-12">
    <!-- Header -->
    <header class="flex items-start justify-between bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm mb-8">
      <div class="flex items-center">
        ${avatarHtml}
        <div>
          <h1 class="text-2xl font-extrabold text-slate-900 leading-none mb-1.5">${escapeXml(title)}</h1>
          <p class="text-sm font-semibold text-indigo-600 mb-1">${escapeXml(subtitle)}</p>
          <p class="text-xs text-slate-400 max-w-md">${escapeXml(description)}</p>
        </div>
      </div>
      <div>
        <a href="${escapeXml(rssUrl)}" class="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-sm hover:shadow-md transition-all no-underline">
          <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M5 3a1 1 0 000 2c5.523 0 10 4.477 10 10a1 1 0 102 0C17 8.373 11.627 3 5 3z"></path><path d="M4 9a1 1 0 011-1 7 7 0 017 7 1 1 0 11-2 0 5 5 0 00-5-5 1 1 0 01-1-1z"></path><circle cx="5" cy="15" r="1"></circle></svg>
          RSS Feed
        </a>
      </div>
    </header>

    <!-- Feed Items -->
    <main class="space-y-6">
      ${itemsHtml}
    </main>

    <footer class="text-center py-10 text-xs text-slate-400 mt-12 border-t border-slate-200/60">
      Powered by <a href="/" class="text-indigo-500 hover:text-indigo-600 font-semibold no-underline">feeds.social</a>
    </footer>
  </div>
</body>
</html>`;
}

// Custom Feed endpoint supporting explicit extension/formats: .rss, /rss.xml, and .html
const handleFeedRequest = async (c: any) => {
  const uuidAndExt = c.req.param('uuidAndExt');
  const path = c.req.path;
  const isHtml = path.endsWith('.html');
  
  let uuid = c.req.param('uuid');
  if (uuidAndExt) {
    if (uuidAndExt.endsWith('.rss')) {
      uuid = uuidAndExt.slice(0, -4);
    } else if (uuidAndExt.endsWith('.html')) {
      uuid = uuidAndExt.slice(0, -5);
    } else {
      uuid = uuidAndExt;
    }
  }

  const feed = await getCustomFeedByUuid(uuid);
  const { rows: trackCheck } = feed
    ? { rows: [{ id: null, name: null, query: null }] }
    : await db.query<{ id: string; name: string; query: string }>(
        'SELECT id, name, query FROM tracks WHERE uuid = $1 AND feed_published = true',
        [uuid]
      );


  if (!feed && trackCheck.length === 0) {
    return c.text('Feed not found', 404);
  }

  const feedName = feed?.name || trackCheck[0]?.name || 'Custom Feed';
  const feedQuery = feed?.query || trackCheck[0]?.query || '';
  const feedDesc = feed?.description || `Custom RSS feed for "${feedQuery}" on feeds.social`;

  // Fetch matches
  const { rows: matches } = await db.query<{ post_uri: string; post_did: string; post_text: string; matched_at: Date; facets: any; embed: any }>(
    `SELECT tm.post_uri, tm.post_did, tm.post_text, tm.matched_at, tm.facets, tm.embed
     FROM tracks t
     JOIN track_matches tm ON tm.track_id = t.id
     WHERE t.uuid = $1
     ORDER BY tm.matched_at DESC
     LIMIT 50`,
    [uuid]
  );

  // Resolve author profiles in batch
  const authorDids = [...new Set(matches.map(m => m.post_did))];
  const profileMap = await getCachedProfiles(authorDids);

  const items: RssFeedItem[] = matches.map(m => {
    const profile = profileMap.get(m.post_did) || { handle: m.post_did, displayName: m.post_did, avatar: '' };
    const rkey = m.post_uri.split('/').pop() || '';
    const postUrl = `https://bsky.app/profile/${profile.handle}/post/${rkey}`;
    const descriptionHtml = postToHtml(m.post_text, m.facets);
    const embedHtml = formatEmbedHtml(m.embed, m.post_did);
    const desc = descriptionHtml + embedHtml;

    const embedMarkdown = formatEmbedMarkdown(m.embed, m.post_did);
    const markdown = m.post_text + embedMarkdown;

    const imageUrl = getPostImageUrl(m.embed, m.post_did);

    return {
      title: '',
      link: postUrl,
      description: desc,
      authorName: profile.displayName || profile.handle,
      authorUri: `at://${m.post_did}`,
      pubDate: m.matched_at.toISOString(),
      guid: m.post_uri,
      imageUrl,
      markdown
    };
  });

  if (isHtml) {
    const cleanRssPath = path.replace('.html', '.rss');
    return c.html(renderHtmlFeed(feedName, `Search: "${feedQuery}"`, feedDesc, FEEDS_BASE_URL + cleanRssPath, items));
  } else {
    const xml = generateRssFeed({
      title: `${feedName} — feeds.social`,
      description: feedDesc,
      link: `${FEEDS_BASE_URL}/?q=${encodeURIComponent(feedQuery)}`,
      feedUrl: FEEDS_BASE_URL + path,
      cloudUrl: `${FEEDS_BASE_URL}/pleaseNotify`,
      items
    });
    c.header('Content-Type', 'application/rss+xml; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(xml);
  }
};

app.get('/feed/:uuidAndExt', handleFeedRequest);
app.get('/feed/:uuid/rss.xml', handleFeedRequest);

// User feed endpoint supporting explicit extension/formats: .rss and .html
const handleUserRequest = async (c: any) => {
  const handleOrDidAndExt = c.req.param('handleOrDidAndExt');
  const path = c.req.path;
  const isHtml = path.endsWith('.html');

  let handleOrDid = handleOrDidAndExt;
  if (handleOrDidAndExt) {
    if (handleOrDidAndExt.endsWith('.rss')) {
      handleOrDid = handleOrDidAndExt.slice(0, -4);
    } else if (handleOrDidAndExt.endsWith('.html')) {
      handleOrDid = handleOrDidAndExt.slice(0, -5);
    }
  }


  let actor: any;
  try {
    actor = await resolveActor(handleOrDid);
  } catch (err) {
    return c.text('User not found', 404);
  }

  // 1. Fetch standard.site documents from DB
  const { rows: docs } = await db.query(`
    SELECT uri, title, site, path, published_at, created_at,
           COALESCE(raw_record->>'content', raw_record->>'textContent') AS text_content,
           raw_record->'content' AS content_json,
           raw_record->'tags' AS tags_json,
           COALESCE(
             raw_record->'coverImage'->'ref'->>'$link',
             raw_record->'images'->0->'image'->'ref'->>'$link',
             raw_record->'images'->0->'ref'->>'$link'
           ) AS cover_cid
    FROM site_standard_articles
    WHERE author_did = $1 AND verified = true AND suppressed IS NOT TRUE
    ORDER BY published_at DESC
    LIMIT 30
  `, [actor.did]);

  // 2. Fetch Bluesky posts
  const bskyFeed = await getAuthorPosts(actor.did, 30);
  const ownPosts = bskyFeed.filter((item: any) => item.post && item.post.author.did === actor.did && !item.reason);

  // 3. Map both to RSS Feed Items
  const feedItems: RssFeedItem[] = [];

  // Map standard.site docs
  for (const doc of docs) {
    const rkey = doc.uri.split('/').pop() || '';
    const canonicalUrl = doc.site && doc.path
      ? `${doc.site.replace(/\/$/, '')}${doc.path.startsWith('/') ? '' : '/'}${doc.path}`
      : `https://blogs.social/read/${actor.did}/${rkey}`;

    let descriptionHtml = '';
    if (doc.content_json && typeof doc.content_json === 'object' && isLeafletContent(doc.content_json)) {
      descriptionHtml = renderLeafletHtml(doc.content_json, actor.did);
    } else {
      descriptionHtml = renderContent(doc.text_content || '');
    }

    const markdown = doc.content_json && typeof doc.content_json === 'object' && isLeafletContent(doc.content_json)
      ? leafletToMarkdown(doc.content_json, actor.did)
      : doc.text_content;

    const imageUrl = doc.cover_cid
      ? `https://cdn.bsky.app/img/feed_fullsize/plain/${actor.did}/${doc.cover_cid}@jpeg`
      : null;

    feedItems.push({
      title: doc.title || 'Untitled Document',
      link: canonicalUrl,
      description: descriptionHtml,
      authorName: actor.displayName || actor.handle,
      authorUri: `at://${actor.did}`,
      pubDate: doc.published_at ? doc.published_at.toISOString() : doc.created_at.toISOString(),
      guid: doc.uri,
      imageUrl,
      markdown
    });
  }

  // Map Bluesky posts
  for (const item of ownPosts) {
    const post = item.post;
    const rkey = post.uri.split('/').pop() || '';
    const postUrl = `https://bsky.app/profile/${actor.handle}/post/${rkey}`;
    const descriptionHtml = postToHtml(post.record.text, post.record.facets);
    const embedHtml = formatEmbedHtml(post.embed, actor.did);
    const desc = descriptionHtml + embedHtml;

    const embedMarkdown = formatEmbedMarkdown(post.embed, actor.did);
    const markdown = post.record.text + embedMarkdown;

    const imageUrl = getPostImageUrl(post.embed, actor.did);

    const title = '';

    feedItems.push({
      title,
      link: postUrl,
      description: desc,
      authorName: actor.displayName || actor.handle,
      authorUri: `at://${actor.did}`,
      pubDate: post.record.createdAt,
      guid: post.uri,
      imageUrl,
      markdown
    });
  }

  // Sort combined items chronologically
  feedItems.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });

  if (isHtml) {
    const cleanRssPath = path.replace('.html', '.rss');
    return c.html(renderHtmlFeed(
      actor.displayName || actor.handle,
      `@${actor.handle}`,
      `Combined feed of Bluesky posts and standard.site documents from ${actor.displayName || actor.handle}`,
      FEEDS_BASE_URL + cleanRssPath,
      feedItems,
      actor.avatar
    ));
  } else {
    const xml = generateRssFeed({
      title: `${actor.displayName || actor.handle} — RSS Feed`,
      description: `Combined feed of Bluesky posts and standard.site documents from @${actor.handle}`,
      link: `https://bsky.app/profile/${actor.handle}`,
      feedUrl: FEEDS_BASE_URL + path,
      cloudUrl: `${FEEDS_BASE_URL}/pleaseNotify`,
      imageUrl: actor.avatar || undefined,
      items: feedItems
    });
    c.header('Content-Type', 'application/rss+xml; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(xml);
  }
};

app.get('/user/:handleOrDidAndExt', handleUserRequest);

app.get('/user-feeds', async (c) => {
  const userId = c.get('userId');
  const user = userId ? await getFeedUserById(userId) : null;
  const q = c.req.query('q') || '';

  let resultsHtml = '';
  if (q) {
    try {
      const agent = await getSearchAgent();
      const res = await agent.app.bsky.actor.searchActors({ q, limit: 20 });
      const actors = res.data.actors || [];

      if (actors.length > 0) {
        resultsHtml = `
          <div class="fade-in space-y-4">
            <h2 class="text-sm font-semibold text-slate-500 mb-2">Search Results</h2>
            ${actors.map(actor => {
              const displayName = actor.displayName || actor.handle;
              const bio = actor.description ? `<p class="text-xs text-slate-500 mt-1 max-w-xl leading-relaxed">${escapeHtml(actor.description)}</p>` : '';
              const avatar = actor.avatar
                ? `<img src="${escapeHtml(actor.avatar)}" class="w-12 h-12 rounded-full shrink-0 border border-slate-200" alt="">`
                : `<div class="w-12 h-12 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-500 text-white flex items-center justify-center text-lg font-bold shrink-0">${displayName[0].toUpperCase()}</div>`;

              return `
                <div class="bg-white rounded-xl border border-slate-200 p-5 flex items-start justify-between gap-4 transition-all hover:shadow-sm">
                  <div class="flex gap-3 min-w-0">
                    ${avatar}
                    <div class="min-w-0">
                      <h3 class="text-sm font-bold text-slate-800 truncate">${escapeHtml(displayName)}</h3>
                      <p class="text-xs text-slate-400">@${escapeHtml(actor.handle)}</p>
                      ${bio}
                    </div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <a href="/user/${actor.handle}.html" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors no-underline">
                      HTML
                    </a>
                    <a href="/user/${actor.handle}.rss" class="bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors no-underline">
                      RSS
                    </a>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      } else {
        resultsHtml = `
          <div class="text-center py-12">
            <p class="text-slate-400 text-sm">No users found for "<strong>${escapeHtml(q)}</strong>". Try another handle or name.</p>
          </div>
        `;
      }
    } catch (err: any) {
      logger.error({ err, q }, 'User search failed');
      resultsHtml = `
        <div class="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 text-center">
          Failed to search users: ${escapeHtml(err.message)}
        </div>
      `;
    }
  }

  const content = `
    <div class="max-w-3xl mx-auto px-6 pt-10 pb-12">
      <div class="text-center mb-8">
        <h1 class="text-3xl font-extrabold text-slate-900 mb-2">User Feeds</h1>
        <p class="text-sm text-slate-500 max-w-md mx-auto">
          Search for any Bluesky user to access their combined RSS and HTML feed (posts + standard.site blogs).
        </p>
      </div>

      <!-- Search bar -->
      <form action="/user-feeds" method="GET" class="max-w-2xl mx-auto mb-10">
        <div class="relative flex items-center bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
          <svg class="w-5 h-5 text-slate-400 ml-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
          </svg>
          <input
            type="text"
            name="q"
            value="${escapeHtml(q)}"
            placeholder="Search by name, handle, or DID..."
            class="flex-1 px-4 py-4 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none bg-transparent"
            autofocus
          >
          <button type="submit" class="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-5 py-2.5 rounded-xl mr-2 transition-all cursor-pointer">
            Search
          </button>
        </div>
      </form>

      <!-- Results -->
      <div id="user-results" class="space-y-4">
        ${resultsHtml}
      </div>
    </div>
  `;

  return c.html(renderLayout(user, content, 'Search User Feeds — feeds.social'));
});

// RSS Cloud pleaseNotify registration endpoint
app.post('/pleaseNotify', async (c) => {
  const body = await c.req.parseBody();
  const domain = String(body.domain || '').trim();
  const port = parseInt(String(body.port || '80'), 10);
  const path = String(body.path || '').trim();
  const protocol = String(body.protocol || '').trim();

  let reqDomain = domain;
  if (!reqDomain) {
    const forwardedFor = c.req.header('x-forwarded-for');
    reqDomain = forwardedFor ? forwardedFor.split(',')[0].trim() : '127.0.0.1';
  }

  const feedUrls: string[] = [];
  if (body.url) feedUrls.push(String(body.url).trim());
  for (const key of Object.keys(body)) {
    if (key.startsWith('url')) {
      feedUrls.push(String(body[key]).trim());
    }
  }

  if (feedUrls.length === 0) {
    c.header('Content-Type', 'text/xml');
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<notifyResult success="false" msg="No feed URLs (url1, url2...) specified in body"/>`);
  }

  if (protocol !== 'http-post') {
    c.header('Content-Type', 'text/xml');
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<notifyResult success="false" msg="Unsupported protocol: ${escapeXml(protocol)}. Only http-post is supported."/>`);
  }

  try {
    for (const feedUrl of feedUrls) {
      await registerSubscriber(feedUrl, reqDomain, port, path, protocol);
    }
    c.header('Content-Type', 'text/xml');
    return c.body('<?xml version="1.0" encoding="UTF-8"?>\n<notifyResult success="true"/>');
  } catch (err: any) {
    logger.error({ err }, 'Failed to register RSS Cloud subscription');
    c.header('Content-Type', 'text/xml');
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<notifyResult success="false" msg="${escapeXml(err.message)}"/>`);
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: FEEDS_PORT }, () => {
  logger.info({ port: FEEDS_PORT }, 'feeds.social web server started');
});

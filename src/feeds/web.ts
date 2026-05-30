import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { createHmac } from 'crypto';
import { logger } from '../lib/logger.js';
import { feedsAuthRouter, getOAuthClient, getAgent } from './auth.js';
import { getFeedUserById, createCustomFeed, getCustomFeedByUuid, getCustomFeedsByOwner, updateCustomFeedBskyUri } from './db.js';
import type { FeedUser, CustomFeed } from './db.js';
import { searchSiteStandardArticles, getOsClient, upsertTrackQuery } from '../track/opensearch.js';
import { db } from '../db/client.js';
import { embedText } from '../track/embedClient.js';

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

// ─── Optional auth middleware (sets userId if logged in, but doesn't redirect) ─
app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/login') || c.req.path.startsWith('/oauth') || c.req.path === '/favicon.png' || c.req.path === '/client-metadata.json') {
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

app.get('/', async (c) => {
  const userId = c.get('userId');
  const user = userId ? await getFeedUserById(userId) : null;
  const q = c.req.query('q') || '';

  const content = `
    <div class="max-w-4xl mx-auto px-6 pt-16 pb-12">
      <!-- Hero -->
      <div class="text-center mb-12">
        <h1 class="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4 leading-tight">
          Create a <span class="bg-gradient-to-r from-indigo-600 to-violet-500 bg-clip-text text-transparent">custom feed</span><br>from any topic
        </h1>
        <p class="text-lg text-slate-500 max-w-lg mx-auto">
          Search for any subject and instantly generate a personalized Bluesky feed. No setup required.
        </p>
      </div>

      <!-- Search bar -->
      <form action="/" method="GET" class="max-w-2xl mx-auto mb-12" id="search-form">
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
              placeholder="climate change, AI regulation, local sports..."
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
        ${q ? '' : renderEmptyState()}
      </div>
    </div>
  `;

  if (!q) {
    return c.html(renderLayout(user, content, 'feeds.social — Create Custom Bluesky Feeds'));
  }

  // Run search
  try {
    const hits = await searchSiteStandardArticles(q, 'all', 'relevant', 20);
    const results = hits?.hits ?? [];

    const resultsHtml = results.length > 0 ? `
      <div class="fade-in">
        <div class="flex items-center justify-between mb-6">
          <p class="text-sm text-slate-500">${hits.total?.value ?? results.length} results for "<strong>${escapeHtml(q)}</strong>"</p>
          <button
            hx-post="/api/feeds/create"
            hx-vals='${JSON.stringify({ query: q, name: q })}'
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
          ${results.map((hit: any) => renderArticleCard(hit)).join('')}
        </div>
      </div>
    ` : `
      <div class="fade-in text-center py-12">
        <p class="text-slate-400 text-sm">No results found for "<strong>${escapeHtml(q)}</strong>". Try a different query.</p>
      </div>
    `;

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

function renderArticleCard(hit: any): string {
  const src = hit._source || {};
  const title = src.title || 'Untitled';
  const site = src.site || '';
  const published = src.published_at ? new Date(src.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const highlight = hit.highlight?.['text_content']?.[0] || hit.highlight?.['text_content.en']?.[0] || '';
  const wordCount = src.word_count ? `${Math.round(src.word_count / 200)} min read` : '';
  const verified = src.verified;

  return `
    <div class="bg-white rounded-xl border border-slate-200 hover:border-slate-300 p-4 transition-all hover:shadow-sm">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <h3 class="text-sm font-bold text-slate-800 leading-snug mb-1">${escapeHtml(title)}</h3>
          <div class="flex items-center gap-2 text-[11px] text-slate-400 mb-2">
            ${verified ? '<span class="text-emerald-500" title="Verified source">✓</span>' : ''}
            <span class="font-medium text-slate-500">${escapeHtml(site)}</span>
            ${published ? `<span>·</span><span>${published}</span>` : ''}
            ${wordCount ? `<span>·</span><span>${wordCount}</span>` : ''}
          </div>
          ${highlight ? `<p class="text-xs text-slate-500 leading-relaxed line-clamp-2">${highlight}</p>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ─── Create Feed API ────────────────────────────────────────────────────────

app.post('/api/feeds/create', async (c) => {
  const userId = c.get('userId');
  const user = userId ? await getFeedUserById(userId) : null;

  const body = await c.req.parseBody();
  const query = String(body.query || '').trim();
  const name = String(body.name || query).trim();

  if (!query) {
    return c.html('<div class="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">Please provide a search query.</div>');
  }

  try {
    // 1. Run the search to get seed URIs
    const hits = await searchSiteStandardArticles(query, 'all', 'relevant', 30);
    const seedUris = (hits?.hits ?? [])
      .map((h: any) => h._source?.bsky_post_uri)
      .filter((uri: string | undefined): uri is string => Boolean(uri && uri.startsWith('at://')));

    // 2. Create custom_feeds row
    const feed = await createCustomFeed({
      owner_id: user?.id ?? null,
      name,
      query,
      description: `Custom feed: ${name}`,
      seed_uris: seedUris,
    });

    // 3. Create a corresponding track row so the worker starts percolating
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

    // 4. Embed the query for semantic matching
    try {
      const embedding = await embedText(query);
      if (embedding && trackRows[0]) {
        await db.query(
          'UPDATE tracks SET query_embedding = $1 WHERE id = $2',
          [JSON.stringify(embedding), trackRows[0].id]
        );
      }
    } catch (err) {
      logger.warn({ err }, 'Embed failed (non-fatal)');
    }

    // 5. Publish to Bluesky PDS
    let bskyUri = '';
    try {
      const { AtpAgent } = await import('@atproto/api');
      const handle = process.env.FEEDS_BSKY_HANDLE;
      const password = process.env.FEEDS_BSKY_PASSWORD;
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
            description: `Custom feed: ${name}`,
            createdAt: new Date().toISOString(),
          },
        });
        bskyUri = res.data.uri;
        await updateCustomFeedBskyUri(feed.id, bskyUri);

        // Also mark the linked track as published
        if (trackRows[0]) {
          await db.query('UPDATE tracks SET feed_published = true WHERE id = $1', [trackRows[0].id]);
        }
      }
    } catch (err) {
      logger.error({ err, uuid: feed.uuid }, 'Failed to publish feed to Bluesky');
    }

    // 6. Build the bsky.app URL for the feed
    const feedsHandle = process.env.FEEDS_BSKY_HANDLE ?? 'feeds.social';
    const bskyAppUrl = bskyUri
      ? `https://bsky.app/profile/${feedsHandle}/feed/${feed.uuid}`
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
            <p class="text-xs text-emerald-600 mb-3">Seeded with ${seedUris.length} articles. New matches will be added automatically.</p>
            ${bskyAppUrl ? `
              <a href="${bskyAppUrl}" target="_blank" rel="noopener" class="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-all no-underline shadow-sm hover:shadow-md">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                Open in Bluesky
              </a>
            ` : '<p class="text-xs text-amber-600">Feed created locally but Bluesky publishing is not configured.</p>'}
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
    const feedsHandle = process.env.FEEDS_BSKY_HANDLE ?? 'feeds.social';
    const bskyAppUrl = f.bsky_uri
      ? `https://bsky.app/profile/${feedsHandle}/feed/${f.uuid}`
      : null;

    return `
      <div class="bg-white rounded-xl border border-slate-200 hover:border-slate-300 p-5 transition-all hover:shadow-sm fade-in">
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1">
            <h3 class="text-sm font-bold text-slate-800 mb-1">${escapeHtml(f.name)}</h3>
            <p class="text-xs text-slate-400 mb-2">Query: "${escapeHtml(f.query)}" · ${(f.seed_uris as any)?.length ?? 0} seeds</p>
            <div class="flex items-center gap-2">
              ${f.is_public ? '<span class="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full">LIVE</span>' : '<span class="bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded-full">LOCAL</span>'}
              <span class="text-[10px] text-slate-400">${new Date(f.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          ${bskyAppUrl ? `
            <a href="${bskyAppUrl}" target="_blank" rel="noopener" class="shrink-0 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors no-underline">
              Open ↗
            </a>
          ` : ''}
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

// ─── Feed Skeleton (Bluesky calls this) ─────────────────────────────────────

app.get('/xrpc/app.bsky.feed.getFeedSkeleton', async (c) => {
  const feedParam = c.req.query('feed') ?? '';
  const rkeyMatch = feedParam.match(/\/app\.bsky\.feed\.generator\/([^/]+)$/);
  if (!rkeyMatch) return c.json({ error: 'UnknownFeed', message: 'Unknown feed' }, 400);

  const rkey = rkeyMatch[1];
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30', 10), 100);
  const cursor = c.req.query('cursor') ?? undefined;

  const feed = await getCustomFeedByUuid(rkey);
  if (!feed) return c.json({ error: 'UnknownFeed', message: 'Feed not found' }, 404);

  // Try to get dynamic matches from the track_matches table first
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

  // Fall back to seed URIs
  const seedUris = (feed.seed_uris as any) || [];
  if (Array.isArray(seedUris) && seedUris.length > 0) {
    const page = seedUris.slice(0, limit);
    return c.json({ feed: page.map((uri: string) => ({ post: uri })) });
  }

  return c.json({ feed: [] });
});

app.get('/xrpc/app.bsky.feed.describeFeedGenerator', (c) => {
  return c.json({
    did: FEEDS_DID,
    feeds: [],
  });
});

// ─── Start ──────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: FEEDS_PORT }, () => {
  logger.info({ port: FEEDS_PORT }, 'feeds.social web server started');
});

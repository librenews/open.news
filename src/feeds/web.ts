import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { createHmac } from 'crypto';
import { logger } from '../lib/logger.js';
import { feedsAuthRouter, getAgent } from './auth.js';
import { getFeedUserById, getUserColumns, getColumnById, insertColumn, deleteColumn, FeedUser } from './db.js';

type Variables = {
  userId: bigint;
};

const app = new Hono<{ Variables: Variables }>();
const FEEDS_PORT = parseInt(process.env.FEEDS_PORT ?? '4300', 10);
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-secret';

app.route('/', feedsAuthRouter);

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/login') || c.req.path.startsWith('/oauth') || c.req.path === '/favicon.png' || c.req.path === '/client-metadata.json') {
    return next();
  }

  const cookie = getCookie(c, 'feeds_session');
  if (!cookie) return c.redirect('/login');

  const [payload, sig] = cookie.split('.');
  if (!payload || !sig) return c.redirect('/login');

  const expectedSig = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  if (sig !== expectedSig) return c.redirect('/login');

  const userId = BigInt(payload);
  c.set('userId', userId);
  await next();
});

// ─── Setup HTMX + Alpine.js UI ──────────────────────────────────────────────

function renderApp(user: FeedUser, content: string): string {
  // We use slightly tailored styling suitable for horizontal scroll
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>feeds.social</title>
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <!-- Interactive toolset -->
  <script src="https://unpkg.com/htmx.org@1.9.12"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js"></script>
  
  <style>
    /* Ensure the body won't scroll vertically unnecessarily when horizontal scrolling is main */
    html, body {
      height: 100%;
      overflow: hidden;
    }
  </style>
</head>
<body class="bg-slate-100 font-[Inter] text-slate-800 h-full flex flex-col" x-data="{ searchOpen: false }" @keydown.escape.window="searchOpen = false">
  <!-- Minimalist Nav -->
  <nav class="bg-white border-b border-slate-200 shrink-0">
    <div class="px-4 flex justify-between items-center h-12">
      <div class="flex items-center gap-3">
        <h1 class="text-lg font-bold text-slate-800 tracking-tight">feeds.social</h1>
        <button @click="searchOpen = true" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-semibold px-2.5 py-1 rounded-md transition-colors cursor-pointer">
          + Add Feed
        </button>
      </div>
      
      <div class="relative group" x-data="{ open: false }">
        <button @click="open = !open" @click.outside="open = false" class="flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 overflow-hidden ring-2 ring-transparent hover:ring-indigo-500 transition-all focus:outline-none">
          ${user.avatar_url ? `<img src="${user.avatar_url}" alt="@${user.handle}" class="w-full h-full object-cover">` : `<span class="text-[10px] font-semibold text-slate-500">${user.handle.slice(0, 2).toUpperCase()}</span>`}
        </button>
        <div x-show="open" style="display: none;" class="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden">
          <div class="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <p class="text-sm font-medium text-slate-900 truncate">${user.display_name ?? user.handle}</p>
            <p class="text-xs text-slate-500 truncate">@${user.handle}</p>
          </div>
          <form method="POST" action="/oauth/logout" class="block w-full m-0">
            <button type="submit" class="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-slate-50 transition-colors focus:outline-none">Sign out</button>
          </form>
        </div>
      </div>
    </div>
  </nav>

  <!-- Horizontal Scroll Container -->
  <main class="flex-1 overflow-x-auto overflow-y-hidden p-4">
    ${content}
  </main>

  <!-- Search Modal overlay -->
  <div x-show="searchOpen" style="display: none;" class="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-slate-900/40 backdrop-blur-sm">
    <div @click.outside="searchOpen = false" class="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border border-slate-200">
      <div class="p-4 border-b border-slate-100">
        <input type="text" name="q" placeholder="Search for custom feeds..." 
               class="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 outline-none"
               hx-post="/api/search/feeds" 
               hx-trigger="input changed delay:400ms, search" 
               hx-target="#search-results">
        <p class="text-xs text-slate-400 mt-2">Powered by ATProto FeedGenerator Search</p>
      </div>
      <div id="search-results" class="max-h-96 overflow-y-auto bg-slate-50/50 p-2" @htmx:after-request.camel="if($event.detail.elt.id === 'search-results') searchOpen = false">
        <!-- Results appended here -->
        <div class="text-center text-xs text-slate-500 py-6">Type to search existing feeds directly from Bluesky.</div>
      </div>
    </div>
  </div>

  <script>
    // Alpine component to manage horizontal Sortable
    document.addEventListener('alpine:init', () => {
      Alpine.data('columnManager', () => ({
        init() {
          if (this.$refs.columnsContainer) {
            new Sortable(this.$refs.columnsContainer, {
              animation: 150,
              handle: '.cursor-move',
              ghostClass: 'opacity-50',
              onEnd: (evt) => {
                // Future point: send htmx request to save new column order via column IDs map
              }
            });
          }
        }
      }));
    });
  </script>
</body>
</html>`;
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const userId = c.get('userId');
  const user = await getFeedUserById(userId);
  if (!user) {
    const { deleteCookie } = await import('hono/cookie');
    deleteCookie(c, 'feeds_session', { path: '/' });
    return c.redirect('/login');
  }

  let columns = await getUserColumns(userId);

  if (columns.length === 0) {
    await insertColumn({ user_id: userId, feed_type: 'following', title: 'Following', position: 0 });
    return c.redirect('/');
  }

  // Build columns UI
  const columnsHtml = columns.map(col => `
    <div class="shrink-0 w-80 h-full bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col" data-id="${col.id}">
      <!-- Column Header -->
      <div class="px-3 py-2 border-b border-slate-100 flex items-center justify-between cursor-move bg-slate-50 rounded-t-xl group">
        <h2 class="text-sm font-semibold text-slate-800 truncate select-none">${col.title}</h2>
        <button hx-delete="/api/columns/${col.id}" hx-target="closest .shrink-0" hx-swap="outerHTML" hx-confirm="Remove this feed from your deck?" class="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>
      <!-- Column Feed Container (Loaded via HTMX later) -->
      <div class="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-100/50" hx-get="/api/columns/${col.id}/feed" hx-trigger="load">
        <div class="text-center text-xs text-slate-500 py-4 flex flex-col items-center">
          <svg class="animate-spin h-5 w-5 text-indigo-500 mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          Loading feed...
        </div>
      </div>
    </div>
  `).join('');

  const emptyHtml = `
    <div class="flex flex-col items-center justify-center w-full h-full text-slate-400">
      <p class="mb-4">No feeds added yet.</p>
      <button @click="searchOpen = true" class="bg-indigo-500 hover:bg-indigo-600 text-white font-medium px-4 py-2 rounded-lg transition-colors shadow-sm cursor-pointer">
        Add your first feed
      </button>
    </div>
  `;

  return c.html(renderApp(user, `
    <div id="deck-container" x-data="columnManager" x-ref="columnsContainer" class="flex h-full gap-4 items-start">
      ${columns.length > 0 ? columnsHtml : emptyHtml}
    </div>
  `));
});

// ─── HTMX Endpoints ─────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

app.get('/api/columns/:id/feed', async (c) => {
  const userId = c.get('userId');
  const user = await getFeedUserById(userId);
  if (!user) return c.text('Unauthorized', 401);

  const colId = parseInt(c.req.param('id'), 10);
  const cursor = c.req.query('cursor');
  
  const column = await getColumnById(colId);
  if (!column || Number(column.user_id) !== Number(userId)) {
    return c.text('Not found', 404);
  }

  try {
    const session = await getAgent(user.did);
    const { Agent } = await import('@atproto/api');
    const agent = new Agent(session);
    
    let postsHtml = '';
    let nextCursor: string | undefined = undefined;
    let feedItems: any[] = [];

    if (column.feed_type === 'following') {
      const res = await agent.getTimeline({ cursor, limit: 30 });
      nextCursor = res.data.cursor;
      feedItems = res.data.feed;
    } else if (column.feed_type === 'custom' && column.feed_uri) {
      const res = await agent.app.bsky.feed.getFeed({ feed: column.feed_uri, cursor, limit: 30 });
      nextCursor = res.data.cursor;
      feedItems = res.data.feed;
    }

    if (feedItems) {
      postsHtml = feedItems.map((item: any, index: number) => {
        const post = item.post;
        const author = post.author;
        const record = post.record as any;
        const text = record?.text || '';
        const isLast = (index === feedItems.length - 1);
        
        let htmxAttrs = '';
        if (isLast && nextCursor) {
          htmxAttrs = `hx-get="/api/columns/${colId}/feed?cursor=${encodeURIComponent(nextCursor)}" hx-trigger="intersect once" hx-swap="afterend"`;
        }

        return `
          <div class="bg-white p-3 rounded-lg shadow-sm border border-slate-200" ${htmxAttrs}>
            <div class="flex items-start gap-2">
              <img src="${escapeHtml(author.avatar || '/favicon.png')}" class="w-9 h-9 rounded-full object-cover shrink-0 bg-slate-100">
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline justify-between gap-1 mb-0.5">
                  <p class="text-[13px] font-bold text-slate-900 truncate hover:underline cursor-pointer">${escapeHtml(author.displayName || author.handle)}</p>
                  <p class="text-[11px] text-slate-500 truncate whitespace-nowrap">@${escapeHtml(author.handle)}</p>
                </div>
                <p class="text-[13px] text-slate-800 break-words whitespace-pre-wrap leading-snug">${escapeHtml(text)}</p>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    // If initial load and empty
    if (!cursor && !postsHtml) {
      return c.html(`<div class="text-xs text-slate-500 text-center py-4">Nothing to see here right now.</div>`);
    }

    return c.html(postsHtml);
  } catch (err) {
    logger.error({ err, colId }, 'Failed to fetch column feed');
    return c.html(`<div class="text-xs text-red-500 text-center py-4 px-2">Failed to load feed. Session may be expired.</div>`);
  }
});

app.post('/api/search/feeds', async (c) => {
  const userId = c.get('userId');
  const user = await getFeedUserById(userId);
  if (!user) return c.text('Unauthorized', 401);

  const body = await c.req.parseBody();
  const q = typeof body.q === 'string' ? body.q.trim() : '';

  if (!q) {
    return c.html(`<div class="text-center text-xs text-slate-500 py-6">Type to search existing feeds directly from Bluesky.</div>`);
  }

  try {
    const session = await getAgent(user.did);
    const { Agent } = await import('@atproto/api');
    const agent = new Agent(session);
    
    // Check which feeds are already added
    const existingColumns = await getUserColumns(userId);
    const existingUris = new Set(existingColumns.map(c => c.feed_uri));

    const res = await agent.app.bsky.unspecced.getPopularFeedGenerators({ query: q, limit: 15 });
    
    if (!res.data.feeds || res.data.feeds.length === 0) {
      return c.html(`<div class="text-center text-xs text-slate-500 py-6">No feeds found for "${escapeHtml(q)}".</div>`);
    }

    const resultsHtml = res.data.feeds.map(feed => `
      <div class="flex items-center justify-between p-3 hover:bg-slate-100 rounded-xl transition-colors border-b border-slate-100 last:border-0 group">
        <div class="flex items-center gap-3 overflow-hidden">
          <img src="${escapeHtml(feed.avatar || '/favicon.png')}" class="w-10 h-10 rounded-lg object-cover shadow-sm bg-white shrink-0">
          <div class="min-w-0">
            <h4 class="text-sm font-semibold text-slate-900 truncate">${escapeHtml(feed.displayName)}</h4>
            <p class="text-xs text-slate-500 truncate">by @${escapeHtml(feed.creator.handle)} • ${feed.likeCount || 0} likes</p>
          </div>
        </div>
        ${existingUris.has(feed.uri) ? `
          <button disabled class="bg-slate-100 text-slate-400 text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0 ml-3 shadow-sm cursor-not-allowed">
            Already Added
          </button>
        ` : `
          <form hx-post="/api/columns/new" hx-target="#deck-container" hx-swap="beforeend" @submit="searchOpen = false" class="m-0 shrink-0 ml-3">
            <input type="hidden" name="uri" value="${escapeHtml(feed.uri)}">
            <input type="hidden" name="title" value="${escapeHtml(feed.displayName)}">
            <button type="submit" class="bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-sm">
              Add to Deck
            </button>
          </form>
        `}
      </div>
    `).join('');

    return c.html(resultsHtml);
  } catch (err) {
    logger.error({ err, q }, 'Failed to search feeds');
    return c.html(`<div class="text-center text-xs text-red-500 py-6">Search failed.</div>`);
  }
});

app.post('/api/columns/new', async (c) => {
  const userId = c.get('userId');
  
  const body = await c.req.parseBody();
  const uri = typeof body.uri === 'string' ? body.uri : '';
  const title = typeof body.title === 'string' ? body.title : 'Custom Feed';

  if (!uri) return c.text('Missing feed uri', 400);

  const existingColumns = await getUserColumns(userId);
  if (existingColumns.some(c => c.feed_uri === uri)) {
    return c.text('Feed already added', 400);
  }

  const nextPos = existingColumns.length > 0 ? Math.max(...existingColumns.map(c => c.position)) + 1 : 0;

  const col = await insertColumn({
    user_id: userId,
    feed_type: 'custom',
    feed_uri: uri,
    title: title,
    position: nextPos
  });

  const columnHtml = `
    <div class="shrink-0 w-80 h-full bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col" data-id="${col.id}">
      <div class="px-3 py-2 border-b border-slate-100 flex items-center justify-between cursor-move bg-slate-50 rounded-t-xl group">
        <h2 class="text-sm font-semibold text-slate-800 truncate select-none">${escapeHtml(col.title)}</h2>
        <button class="text-slate-400 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path></svg>
        </button>
      </div>
      <div class="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-100/50" hx-get="/api/columns/${col.id}/feed" hx-trigger="load">
        <div class="text-center text-xs text-slate-500 py-4 flex flex-col items-center">
          <svg class="animate-spin h-5 w-5 text-indigo-500 mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
          Loading feed...
        </div>
      </div>
    </div>
  `;

  return c.html(columnHtml);
});

app.delete('/api/columns/:id', async (c) => {
  const userId = c.get('userId');
  const colId = parseInt(c.req.param('id'), 10);
  
  if (!isNaN(colId)) {
    await deleteColumn(colId, userId);
  }
  
  return c.text(''); // Return empty content, HTMX will swap 'outerHTML' and destroy the column block
});

// ─── Start ──────────────────────────────────────────────────────────────────
serve({ fetch: app.fetch, port: FEEDS_PORT }, () => {
  logger.info({ port: FEEDS_PORT }, 'Feeds.social web server started');
});

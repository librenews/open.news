import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { createHmac, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { logger } from '../lib/logger.js';
import { feedsAuthRouter, getOAuthClient, getAgent } from './auth.js';
import { getFeedUserById, getUserColumns, getColumnById, insertColumn, deleteColumn, setAppPassword, removeAppPassword, getFeedUserByRssToken } from './db.js';
import type { FeedUser, FeedColumn } from './db.js';
import { upsertUser } from '../db/queries/users.js';
import { createTrack, updateTrackKeywords, updateTrack, getTrackByUuid, getMatchesByTrackId, updateTrackQueryEmbedding, getTracksByUserId, deleteTrack } from '../db/queries/tracks.js';
import { upsertTrackQuery, searchSiteStandardArticles } from '../track/opensearch.js';
import { embedText } from '../track/embedClient.js';

type Variables = {
  userId: bigint;
};

const app = new Hono<{ Variables: Variables }>();
const FEEDS_PORT = parseInt(process.env.FEEDS_PORT ?? '4300', 10);
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-secret';
const ENCRYPTION_KEY = Buffer.from(SESSION_SECRET.padEnd(32, '0').slice(0, 32));
const FEEDS_BASE_URL = process.env.FEEDS_BASE_URL ?? 'http://localhost:4300';

function encryptPassword(text: string) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptPassword(text: string) {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift()!, 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

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

function renderLayout(user: FeedUser, content: string, title = 'feeds.social'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script>
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        for(let reg of regs) reg.unregister();
      });
    }
  </script>
  <title>${title}</title>
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
<body class="bg-slate-100 font-[Inter] text-slate-800 h-full flex flex-col" x-data="{ rssOpen: false }" @keydown.escape.window="rssOpen = false">
  <!-- Minimalist Nav -->
  <nav class="bg-white border-b border-slate-200 shrink-0">
    <div class="px-4 flex justify-between items-center h-12">
      <div class="flex items-center gap-3">
        <a href="/" class="text-lg font-bold text-slate-800 tracking-tight no-underline">feeds.social</a>
        <a href="/manage" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-semibold px-2.5 py-1 rounded-md transition-colors cursor-pointer no-underline">
          + Add Feed
        </a>
        <a href="/articles" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-semibold px-2.5 py-1 rounded-md transition-colors cursor-pointer no-underline">
          Articles
        </a>
        <button @click="rssOpen = true" class="text-slate-400 hover:text-orange-500 transition-colors focus:outline-none cursor-pointer" title="RSS Config">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 11a9 9 0 019 9M4 4a16 16 0 0116 16M4 20h.01M4 20a1 1 0 110-2 1 1 0 010 2z"></path></svg>
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

  ${content}

  <!-- RSS Modal overlay -->
  <div x-show="rssOpen" style="display: none;" class="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-slate-900/40 backdrop-blur-sm">
    <div @click.outside="rssOpen = false" class="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden border border-slate-200" hx-get="/api/rss/modal" hx-trigger="intersect once" >
      <div class="text-center text-xs text-slate-500 py-12 flex flex-col items-center">
        <svg class="animate-spin h-6 w-6 text-orange-500 mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
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

function renderApp(user: FeedUser, content: string): string {
  return renderLayout(user, `
  <main class="flex-1 overflow-x-auto overflow-y-hidden p-4">
    ${content}
  </main>
  `);
}


// ─── Manage Tracks Route ────────────────────────────────────────────────────
app.get('/manage', async (c) => {
  const userId = c.get('userId');
  const user = await getFeedUserById(userId);
  if (!user) return c.redirect('/login');

  const trackUser = await upsertUser({ did: user.did, handle: user.handle, display_name: user.display_name, avatar_url: user.avatar_url });
  const tracks = await getTracksByUserId(trackUser.id);

  function escHtml(unsafe: string) {
    return String(unsafe).replace(/[&<"']/g, m => ({ '&': '&amp;', '<': '&lt;', '"': '&quot;', "'": '&#39;' })[m] as string);
  }

  const trackRows = tracks.length === 0 ? `<p class="text-xs text-slate-500 p-4">You haven't created any custom tracks yet.</p>` : tracks.map(t => `
    <div class="flex items-center justify-between p-4 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors">
      <div>
        <h4 class="text-sm font-semibold text-slate-800">${escHtml(t.name)}</h4>
        <p class="text-xs text-slate-500 truncate max-w-sm mt-0.5">${escHtml(t.keywords.join(', '))} ${t.query ? `| Semaphore: ${t.threshold.toFixed(2)}` : ''}</p>
      </div>
      <div class="flex items-center gap-3">
        <a href="/manage/edit/${t.uuid}" class="text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer no-underline">Edit</a>
        <form method="POST" action="/api/track/${t.uuid}/delete" onsubmit="return confirm('Are you sure you want to delete this track? This may break your Bluesky feed.');" class="m-0">
          <button type="submit" class="text-xs font-semibold text-red-600 hover:text-red-800 cursor-pointer">Delete</button>
        </form>
      </div>
    </div>
  `).join('');

  const content = `
    <div class="max-w-4xl mx-auto w-full p-6 pt-10 overflow-y-auto">
      <div class="mb-4">
        <a href="/" class="text-sm text-indigo-500 hover:text-indigo-700 transition-colors no-underline font-semibold">&larr; Back to Dashboard</a>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-8 items-start pb-20">
        <!-- Create Form inside a Card -->
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col pt-2" x-data="{ threshold: 0.75 }">
          <div class="px-6 py-4 border-b border-slate-100 bg-slate-50">
            <h2 class="text-lg font-bold text-slate-800">Create Tracker</h2>
            <p class="text-xs text-slate-500 mt-1 mb-2">Build a custom algorithmic feed and sink it to Bluesky.</p>
          </div>
          <div class="p-6">
            <form method="POST" action="/api/track/create" class="space-y-5">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">Tracker Name</label>
                  <input type="text" name="name" required placeholder="e.g., Tech and AI News" class="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5">
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-600 mb-1">Keywords</label>
                  <input type="text" name="keywords" placeholder="e.g., ai, openai, claude" class="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5">
                  <p class="text-[10px] text-slate-400 mt-1">Comma-separated. Max 5.</p>
                </div>
              </div>
              
              <div class="border-t border-slate-100 pt-4">
                <label class="block text-xs font-semibold text-slate-600 mb-1 flex items-center gap-2">
                  Semantic Embed Query <span class="bg-indigo-100 text-indigo-600 text-[10px] px-1.5 py-0.5 rounded font-bold">AI</span>
                </label>
                <textarea name="query" rows="2" placeholder="e.g., News and updates about generative artificial intelligence and large language models." class="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 resize-none"></textarea>
                <p class="text-[10px] text-slate-400 mt-1">Natural language query for semantic matching.</p>
              </div>

              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="block text-xs font-semibold text-slate-600">Similarity Threshold</label>
                  <span class="text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded" x-text="threshold"></span>
                </div>
                <input type="range" name="threshold" x-model="threshold" min="0.5" max="0.9" step="0.01" class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500">
                <div class="flex justify-between text-[10px] text-slate-400 mt-1 px-1">
                  <span>Looser (More results)</span>
                  <span>Stricter (Fewer results)</span>
                </div>
              </div>

              <button type="submit" class="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-2.5 rounded-lg transition-colors shadow-sm cursor-pointer mt-4">
                Create & Publish to Bluesky
              </button>
            </form>
          </div>
          <!-- Powered by track.social -->
          <div class="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex flex-col items-center justify-center text-center">
            <span class="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1 flex items-center gap-1.5">
              Powered by
              <svg class="w-3 h-3 text-indigo-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
              </svg>
            </span>
            <span class="text-xs font-semibold text-slate-600">track.social engine</span>
          </div>
        </div>

        <div class="space-y-6 flex flex-col">
          <!-- Search UI -->
          <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col" x-data="{ tab: 'search' }">
            <div class="px-6 py-4 border-b border-slate-100 bg-slate-50">
              <h2 class="text-lg font-bold text-slate-800">Search Bluesky</h2>
              <p class="text-xs text-slate-500 mt-1">Search and add existing public feeds directly to your deck.</p>
            </div>
            <div class="p-4 border-b border-slate-100">
              <input type="text" name="q" placeholder="Search for feeds..." 
                     class="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 outline-none"
                     hx-post="/api/search/feeds" 
                     hx-trigger="input changed delay:400ms, search" 
                     hx-target="#search-results">
            </div>
            <div id="search-results" class="max-h-64 min-h-[150px] overflow-y-auto bg-slate-50/50 p-2" @htmx:after-request.camel="if($event.detail.elt.id === 'search-results') setTimeout(() => window.location.href = '/', 150)">
              <div class="text-center text-xs text-slate-500 py-6">Type to search existing feeds directly from Bluesky.</div>
            </div>
          </div>

          <!-- My Tracks -->
          <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
            <div class="px-6 py-4 border-b border-slate-100 bg-slate-50">
              <h2 class="text-lg font-bold text-slate-800">My Custom Tracks</h2>
            </div>
            <div class="flex flex-col">
              ${trackRows}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  return c.html(renderLayout(user, content, 'Manage Feeds - feeds.social'));
});

app.get('/manage/edit/:uuid', async (c) => {
  const userId = c.get('userId');
  const uuid = c.req.param('uuid');
  const user = await getFeedUserById(userId);
  if (!user) return c.redirect('/login');
  
  const trackUser = await upsertUser({ did: user.did, handle: user.handle, display_name: user.display_name, avatar_url: user.avatar_url });
  const track = await getTrackByUuid(uuid);
  if (!track || String(track.user_id) !== String(trackUser.id)) return c.text('Not found', 404);

  function escHtml(unsafe: string) {
    return String(unsafe).replace(/[&<"']/g, m => ({ '&': '&amp;', '<': '&lt;', '"': '&quot;', "'": '&#39;' })[m] as string);
  }

  const content = `
    <div class="max-w-2xl mx-auto w-full p-6 pt-10 overflow-y-auto">
      <div class="mb-6">
        <a href="/manage" class="text-sm text-indigo-500 hover:text-indigo-700 transition-colors no-underline font-semibold">&larr; Back to Manage</a>
      </div>
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col pt-2 pb-6">
        <div class="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h2 class="text-xl font-bold text-slate-800">Edit: ${escHtml(track.name)}</h2>
        </div>
        <form method="POST" action="/api/track/${track.uuid}/edit" class="p-6 space-y-5">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Name</label>
            <input type="text" name="name" value="${escHtml(track.name)}" required maxlength="75"
              class="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5">
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1 flex items-center gap-2">Semantic Embed Query <span class="bg-indigo-100 text-indigo-600 text-[10px] px-1.5 py-0.5 rounded font-bold">AI</span></label>
            <textarea name="query" maxlength="600" rows="3"
              class="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 resize-y"
              oninput="document.getElementById('edit-squelch-section').style.display = 'block'">${escHtml(track.query ?? '')}</textarea>
          </div>
          <div id="edit-squelch-section">
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs font-semibold text-slate-600">Similarity Threshold</label>
              <span class="text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded" id="edit-squelch-val">${track.threshold.toFixed(2)}</span>
            </div>
            <input type="range" name="threshold" min="0.5" max="0.9" step="0.01" value="${track.threshold.toFixed(2)}"
              class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500" oninput="document.getElementById('edit-squelch-val').textContent=parseFloat(this.value).toFixed(2)">
          </div>
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">Keywords</label>
            <input type="hidden" name="keywords" id="edit-kw-value" value="${track.keywords.map(k => escHtml(k)).join(',')}">
            <div id="edit-kw-wrap" class="flex flex-wrap gap-1.5 p-2 bg-white border border-slate-200 rounded-lg min-h-[42px] cursor-text focus-within:ring-2 focus-within:ring-indigo-500" onclick="document.getElementById('edit-kw-input').focus()">
              <input type="text" id="edit-kw-input" placeholder="Type and press Enter"
                class="flex-1 min-w-[140px] border-none outline-none text-sm bg-transparent p-0.5">
            </div>
          </div>

          <button type="submit" class="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-semibold py-2.5 rounded-lg transition-colors shadow-sm cursor-pointer mt-4">
            Save Changes
          </button>
        </form>
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
            pill.className = 'kw-pill inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium px-2.5 py-1 rounded-full';
            pill.innerHTML = tag + '<button type="button" class="ml-0.5 text-indigo-400 hover:text-indigo-700 cursor-pointer" data-i="' + i + '">&times;</button>';
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
    </div>
  `;
  return c.html(renderLayout(user, content, 'Edit Track - feeds.social'));
});

app.post('/api/track/:uuid/edit', async (c) => {
  const userId = c.get('userId');
  const uuid = c.req.param('uuid');
  const user = await getFeedUserById(userId);
  if (!user) return c.redirect('/login');
  const trackUser = await upsertUser({ did: user.did, handle: user.handle, display_name: user.display_name, avatar_url: user.avatar_url });
  const track = await getTrackByUuid(uuid);
  if (!track || String(track.user_id) !== String(trackUser.id)) return c.text('Not found', 404);

  const body = await c.req.parseBody();
  const name = String(body.name ?? '').trim().slice(0, 75);
  const keywordsRaw = String(body.keywords ?? '').trim();
  const query = String(body.query ?? '').trim().slice(0, 600);
  const threshold = parseFloat(String(body.threshold ?? '0.75'));
  const keywords = keywordsRaw ? keywordsRaw.split(',').map(k => k.trim().slice(0, 100)).filter(Boolean).slice(0, 5) : [];

  if (!name || (!query && keywords.length === 0)) return c.text('Invalid input', 400);

  await updateTrack(track.id, { name, query: query || undefined, threshold: isNaN(threshold) ? 0.75 : threshold });
  const osQueryId = await upsertTrackQuery(track.id, keywords);
  await updateTrackKeywords(track.id, keywords, osQueryId);

  if (query) {
    try {
      const queryEmbedding = await embedText(query);
      await updateTrackQueryEmbedding(track.id, queryEmbedding);
    } catch (err) {
      logger.error({ err }, 'Failed to embed updated query');
    }
  }

  return c.redirect('/manage');
});

app.post('/api/track/:uuid/delete', async (c) => {
  const userId = c.get('userId');
  const uuid = c.req.param('uuid');
  const user = await getFeedUserById(userId);
  if (!user) return c.redirect('/login');
  const trackUser = await upsertUser({ did: user.did, handle: user.handle, display_name: user.display_name, avatar_url: user.avatar_url });
  const track = await getTrackByUuid(uuid);
  if (!track || String(track.user_id) !== String(trackUser.id)) return c.text('Not found', 404);

  await deleteTrack(track.id);
  const cols = await getUserColumns(userId);
  const atUri = `at://${user.did}/app.bsky.feed.generator/${track.uuid}`;
  for (const col of cols) {
    if (col.feed_uri === atUri) {
      await deleteColumn(col.id, userId);
    }
  }
  return c.redirect('/manage');
});

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

// ─── Articles Search Endpoints ──────────────────────────────────────────────

app.get('/articles', async (c) => {
  const userId = c.get('userId');
  const user = await getFeedUserById(userId);
  if (!user) return c.redirect('/login');

  const content = `
    <div class="max-w-4xl mx-auto w-full p-6 pt-10 overflow-y-auto">
      <div class="mb-4">
        <a href="/" class="text-sm text-indigo-500 hover:text-indigo-700 transition-colors no-underline font-semibold">&larr; Back to Dashboard</a>
      </div>
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col pb-6">
        <div class="px-6 py-6 border-b border-slate-100 bg-slate-50 flex flex-col items-center justify-center text-center">
          <h2 class="text-2xl font-bold text-slate-800">Global Article Search</h2>
          <p class="text-sm text-slate-500 mt-2 max-w-lg">Search the entire AT Protocol ecosystem for long-form content. Indexed securely via site.standard.document.</p>
        </div>
        <div class="p-6 border-b border-slate-100 bg-white sticky top-0 z-10">
          <div class="relative">
            <svg class="absolute left-4 top-3.5 h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" name="q" placeholder="Search across millions of words... (e.g., 'artificial intelligence')" 
                   class="w-full bg-slate-50 border border-slate-200 text-slate-900 text-base rounded-xl focus:ring-indigo-500 focus:border-indigo-500 block py-3 pl-12 pr-4 outline-none transition-shadow hover:shadow-sm"
                   hx-post="/api/articles/search" 
                   hx-trigger="input changed delay:500ms, search" 
                   hx-target="#article-results"
                   hx-indicator="#search-indicator"
                   autofocus>
          </div>
        </div>
        <div id="search-indicator" class="htmx-indicator flex justify-center py-4">
          <svg class="animate-spin h-6 w-6 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        </div>
        <div id="article-results" class="p-4 space-y-4">
          <div class="text-center text-sm text-slate-400 py-12">Enter a search query to explore the ecosystem.</div>
        </div>
      </div>
    </div>
    <style>
      .htmx-indicator { display: none; }
      .htmx-request .htmx-indicator { display: flex; }
      .htmx-request.htmx-indicator { display: flex; }
    </style>
  `;

  return c.html(renderLayout(user, content, 'Search Articles - feeds.social'));
});

app.post('/api/articles/search', async (c) => {
  const userId = c.get('userId');
  const user = await getFeedUserById(userId);
  if (!user) return c.text('Unauthorized', 401);

  const body = await c.req.parseBody();
  const q = typeof body.q === 'string' ? body.q.trim() : '';

  if (!q) {
    return c.html(`<div class="text-center text-sm text-slate-400 py-12">Enter a search query to explore the ecosystem.</div>`);
  }

  try {
    const hits = await searchSiteStandardArticles(q);

    if (!hits.hits || hits.hits.length === 0) {
      return c.html(`<div class="text-center text-sm text-slate-500 py-12">No articles found matching "${escapeHtml(q)}".</div>`);
    }

    const resultsHtml = hits.hits.map((hit: any) => {
      const source = hit._source;
      const highlight = hit.highlight;
      
      // Attempt to find highlighted text content from any matched sub-field
      let snippetHtml = '';
      if (highlight) {
        const textHighlights = Object.keys(highlight)
          .filter(k => k.startsWith('text_content'))
          .flatMap(k => highlight[k]);
        
        if (textHighlights.length > 0) {
          snippetHtml = `<div class="mt-3 text-sm text-slate-600 leading-relaxed border-l-2 border-indigo-200 pl-3 italic">"${textHighlights[0]}"</div>`;
        }
      }

      // If we don't have a highlight, we just won't show a snippet
      
      const publishedDate = source.published_at ? new Date(source.published_at).toLocaleDateString() : 'Unknown Date';
      const langBadge = source.language ? `<span class="bg-slate-100 text-slate-500 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded">${escapeHtml(source.language)}</span>` : '';
      
      // Decide destination URL
      let destUrl = `https://bsky.app/profile/${source.did}`;
      if (source.site && source.path) {
        destUrl = `${source.site}${source.path}`;
      }

      return `
        <a href="${destUrl}" target="_blank" rel="noopener noreferrer" class="block bg-white border border-slate-200 hover:border-indigo-300 rounded-xl p-5 transition-all hover:shadow-md group no-underline">
          <div class="flex justify-between items-start gap-4">
            <div class="min-w-0 flex-1">
              <h3 class="text-lg font-bold text-slate-900 group-hover:text-indigo-600 transition-colors break-words">${escapeHtml(source.title || 'Untitled Article')}</h3>
              <div class="flex items-center gap-2 mt-1.5 flex-wrap">
                <span class="text-xs font-medium text-slate-500">${publishedDate}</span>
                <span class="text-slate-300">•</span>
                <span class="text-xs text-slate-500 truncate font-mono bg-slate-50 px-1 rounded">${escapeHtml(source.did)}</span>
                ${langBadge}
              </div>
              ${snippetHtml}
            </div>
            <div class="shrink-0 text-slate-400 group-hover:text-indigo-500 transition-colors">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
            </div>
          </div>
        </a>
      `;
    }).join('');

    return c.html(resultsHtml);
  } catch (err) {
    logger.error({ err, q }, 'Failed to search articles');
    return c.html(`<div class="text-center text-sm text-red-500 py-6">An error occurred while searching.</div>`);
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

// ─── Track Creation Endpoint ────────────────────────────────────────────────

app.post('/api/track/create', async (c) => {
  const userId = c.get('userId');
  const user = await getFeedUserById(userId);
  if (!user) return c.text('Unauthorized', 401);

  const body = await c.req.parseBody();
  const name = String(body.name ?? '').trim().slice(0, 75);
  const keywordsRaw = String(body.keywords ?? '').trim();
  const query = String(body.query ?? '').trim().slice(0, 600);
  const threshold = parseFloat(String(body.threshold ?? '0.75'));
  const keywords = keywordsRaw ? keywordsRaw.split(',').map(k => k.trim().slice(0, 100)).filter(Boolean).slice(0, 5) : [];

  if (!name || (!query && keywords.length === 0)) return c.text('Invalid input', 400);

  // 1. Sync User to Core Database
  const trackUser = await upsertUser({ did: user.did, handle: user.handle, display_name: user.display_name, avatar_url: user.avatar_url });

  // 2. Create Track & OpenSearch Query
  const track = await createTrack(trackUser.id, name, keywords, '', query || undefined, isNaN(threshold) ? 0.75 : threshold);
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

  // 3. Publish to PDS directly from Feeds UI
  let atUri = '';
  try {
    const client = await getOAuthClient();
    const oauthSession = await client.restore(user.did);
    const { Agent } = await import('@atproto/api');
    const agent = new Agent(oauthSession);

    await agent.com.atproto.repo.putRecord({
      repo: user.did,
      collection: 'app.bsky.feed.generator',
      rkey: track.uuid,
      record: {
        did: 'did:web:track.social',
        displayName: track.name,
        description: `Custom tracking feed for: ${track.name}\\n\\nPowered by track.social`,
        createdAt: new Date().toISOString(),
      }
    });

    await updateTrack(track.id, { feed_published: true });
    atUri = `at://${user.did}/app.bsky.feed.generator/${track.uuid}`;
  } catch (err: any) {
    logger.error({ err, uuid: track.uuid }, 'Failed to publish custom track to PDS via feeds.social');
    atUri = `at://${user.did}/app.bsky.feed.generator/${track.uuid}`; 
  }

  const columns = await getUserColumns(userId);
  const newPos = columns.length;
  const column = await insertColumn({ user_id: userId, feed_type: 'custom', feed_uri: atUri, title: name, position: newPos });
  
  return c.redirect('/manage');
});

// ─── RSS Endpoints ──────────────────────────────────────────────────────────

app.get('/api/rss/modal', async (c) => {
  const userId = c.get('userId');
  const user = await getFeedUserById(userId);
  if (!user) return c.text('Unauthorized', 401);

  if (!user.app_password || !user.rss_token) {
    return c.html(`
      <div class="p-6">
        <h3 class="text-lg font-bold text-slate-800 mb-2">Configure RSS Feeds</h3>
        <p class="text-sm text-slate-500 mb-6 leading-relaxed">
          To generate highly-detailed RSS feeds that fetch automatically in the background, we need an <strong>App Password</strong>. This securely grants our server the ability to read your timelines via ATProto when you're completely offline.
        </p>
        <form hx-post="/api/rss/setup" hx-target="closest div" hx-swap="outerHTML" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-slate-600 mb-1">App Password</label>
            <input type="password" name="password" required placeholder="xxxx-xxxx-xxxx-xxxx"
                   class="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2.5">
            <p class="text-[11px] text-slate-400 mt-1">Generate this in your Bluesky Settings > App Passwords.</p>
          </div>
          <button type="submit" class="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 rounded-lg transition-colors shadow-sm cursor-pointer">
            Save App Password
          </button>
        </form>
      </div>
    `);
  }

  const columns = await getUserColumns(userId);
  const linksHtml = columns.map(c => `
    <div class="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200">
      <div>
        <p class="text-sm font-semibold text-slate-800">${escapeHtml(c.title)}</p>
        <p class="text-xs text-slate-500 mt-0.5 truncate max-w-[280px] font-mono">${FEEDS_BASE_URL}/rss/${user.rss_token}/${c.id}</p>
      </div>
      <button class="bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium px-3 py-1.5 rounded-md cursor-pointer transition-colors shadow-sm"
              onclick="navigator.clipboard.writeText('${FEEDS_BASE_URL}/rss/${user.rss_token}/${c.id}')">
        Copy
      </button>
    </div>
  `).join('');

  return c.html(`
    <div class="p-6">
      <div class="flex justify-between items-start mb-6">
        <div>
          <h3 class="text-lg font-bold text-slate-800">Your RSS URLs</h3>
          <p class="text-xs text-slate-500 mt-1">Paste these endpoints directly into Feedly, Reeder, etc.</p>
        </div>
        <button hx-post="/api/rss/disable" hx-target="closest div.p-6" hx-swap="outerHTML" hx-confirm="Disable your background feeds and clear your Password?" 
                class="text-xs text-red-500 hover:text-red-700 font-medium cursor-pointer">Disable</button>
      </div>
      <div class="space-y-3 max-h-80 overflow-y-auto pr-2">
        ${linksHtml || '<p class="text-xs text-slate-400">Add feeds to your deck to generate URLs.</p>'}
      </div>
    </div>
  `);
});

app.post('/api/rss/setup', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.parseBody();
  const rawPassword = typeof body.password === 'string' ? body.password.trim() : '';

  if (!rawPassword) return c.text('No password', 400);

  const token = randomBytes(16).toString('hex');
  const encrypted = encryptPassword(rawPassword);

  await setAppPassword(userId, encrypted, token);

  return c.html(`<p hx-get="/api/rss/modal" hx-trigger="load" hx-swap="outerHTML"></p>`);
});

app.post('/api/rss/disable', async (c) => {
  const userId = c.get('userId');
  await removeAppPassword(userId);
  return c.html(`<p hx-get="/api/rss/modal" hx-trigger="load" hx-swap="outerHTML"></p>`);
});

function buildFeedRss(title: string, items: any[]): string {
  const rssItems = items.map((item) => {
    const post = item.post;
    const author = post.author;
    const record = post.record;
    
    // AT URI -> Web URL
    const bskyUrl = post.uri.replace('at://', 'https://bsky.app/profile/').replace('/app.bsky.feed.post/', '/post/');
    
    let mediaTags = '';
    let enclosureTags = '';
    let descriptionExt = '';

    if (post.embed) {
      const embed = post.embed;
      if (embed.$type === 'app.bsky.embed.external#view' && embed.external) {
         const ext = embed.external;
         if (ext.thumb) {
            mediaTags += `<media:content url="${escapeHtml(ext.thumb)}" medium="image"><media:title>${escapeHtml(ext.title || '')}</media:title><media:description>${escapeHtml(ext.description || '')}</media:description></media:content>`;
            enclosureTags += `<enclosure url="${escapeHtml(ext.thumb)}" type="image/jpeg" length="0" />`;
            descriptionExt += `<br/><br/><a href="${escapeHtml(ext.uri)}"><img src="${escapeHtml(ext.thumb)}" style="max-width:100%; border-radius:8px;"/><br/><strong>${escapeHtml(ext.title || 'Link')}</strong></a>`;
         }
      } else if (embed.$type === 'app.bsky.embed.images#view' && Array.isArray(embed.images)) {
        for (const img of embed.images) {
           if (img.thumb) {
             mediaTags += `<media:content url="${escapeHtml(img.thumb)}" medium="image"><media:description>${escapeHtml(img.alt || '')}</media:description></media:content>`;
             if (!enclosureTags) enclosureTags += `<enclosure url="${escapeHtml(img.thumb)}" type="image/jpeg" length="0" />`;
             descriptionExt += `<br/><br/><img src="${escapeHtml(img.thumb)}" alt="${escapeHtml(img.alt || '')}" style="max-width:100%; border-radius:8px;" />`;
           }
        }
      } else if (embed.$type === 'app.bsky.embed.record#view' && embed.record && embed.record.value) {
        descriptionExt += `<br/><br/><blockquote style="border-left:4px solid #cbd5e1; padding-left:12px; margin-left:0; color:#475569;">${escapeHtml(embed.record.value.text)}</blockquote>`;
      }
    }

    const postTitle = record.text ? record.text.slice(0, 100) : 'Bluesky Post';
    let finalDescription = escapeHtml(record.text || '');
    finalDescription += descriptionExt;

    let pubDate = '';
    if (record.createdAt) pubDate = new Date(record.createdAt).toUTCString();

    return `<item>
      <title>${escapeHtml(postTitle)}</title>
      <link>${bskyUrl}</link>
      <description><![CDATA[${finalDescription}]]></description>
      ${pubDate ? `<pubDate>${pubDate}</pubDate>` : ''}
      <guid>${post.uri}</guid>
      <author>${post.author.did}</author>
      ${enclosureTags}
      ${mediaTags}
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeHtml(title)}</title>
    <link>${FEEDS_BASE_URL}</link>
    <description>Bluesky feed exported from feeds.social</description>
    <generator>feeds.social</generator>
    ${rssItems}
  </channel>
</rss>`;
}

app.get('/rss/:token/:colId', async (c) => {
  const token = c.req.param('token');
  const colId = parseInt(c.req.param('colId'), 10);

  const user = await getFeedUserByRssToken(token);
  if (!user || (!user.app_password)) return c.text('Invalid token', 401);

  const column = await getColumnById(colId);
  if (!column || Number(column.user_id) !== Number(user.id)) return c.text('Not found', 404);

  const rawPassword = decryptPassword(user.app_password);

  try {
    const { BskyAgent } = await import('@atproto/api');
    const agent = new BskyAgent({ service: 'https://bsky.social' });
    await agent.login({ identifier: user.handle, password: rawPassword });

    let feedItems: any[] = [];
    if (column.feed_type === 'following') {
      const res = await agent.getTimeline({ limit: 30 });
      feedItems = res.data.feed;
    } else if (column.feed_type === 'custom' && column.feed_uri) {
      const res = await agent.app.bsky.feed.getFeed({ feed: column.feed_uri, limit: 30 });
      feedItems = res.data.feed;
    }

    const xml = buildFeedRss(column.title, feedItems || []);
    return c.body(xml, 200, {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=60'
    });
  } catch (err: any) {
    logger.error({ err, handle: user.handle }, 'RSS Background fetch failed');
    if (err.message?.includes('Authentication Required') || err.message?.includes('jwt')) {
      await removeAppPassword(user.id);
    }
    return c.text('Failed to authenticate or fetch feed.', 500);
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────
serve({ fetch: app.fetch, port: FEEDS_PORT }, () => {
  logger.info({ port: FEEDS_PORT }, 'Feeds.social web server started');
});

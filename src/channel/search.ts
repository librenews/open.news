/**
 * News Search API and Page.
 *
 * GET /search?q=...&category=...  — HTML search results page
 * GET /api/search?q=...&category=... — JSON search results
 */
import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import { searchNewsContent, ensureNewsFields } from '../track/opensearch.js';
import { logger } from '../lib/logger.js';
import { getCachedProfiles } from '../lib/pdsCache.js';
import { db } from '../db/client.js';

export const searchRouter = new Hono();

// Ensure news fields exist on startup
ensureNewsFields().catch(() => {});

interface SearchResult {
  uri: string;
  did: string;
  cid: string | null;
  thumbnailCid: string | null;
  postText: string | null;
  transcript: string;
  durationMs: number | null;
  createdAt: string;
  storyLabels: string[];
  storyCategory: string | null;
  score: number;
  authorHandle?: string;
  authorDisplayName?: string;
  authorAvatar?: string | null;
}

function parseHits(hits: any[]): SearchResult[] {
  return hits.map(h => ({
    uri: h._source.uri,
    did: h._source.did,
    cid: null,
    thumbnailCid: null,
    postText: h._source.post_text || null,
    transcript: h._source.transcript || '',
    durationMs: h._source.duration_ms || null,
    createdAt: h._source.created_at,
    storyLabels: h._source.story_labels || [],
    storyCategory: h._source.story_category || null,
    score: h._score,
  }));
}

function atUriToParts(atUri: string): { did: string; rkey: string } | null {
  const m = atUri.match(/^at:\/\/([^/]+)\/[^/]+\/(.+)$/);
  return m ? { did: m[1], rkey: m[2] } : null;
}

function atUriToHttps(atUri: string): string {
  const m = atUri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(.+)$/);
  if (m) return `https://bsky.app/profile/${m[1]}/post/${m[2]}`;
  return atUri;
}

// JSON API
searchRouter.get('/api/search', async (c) => {
  const q = c.req.query('q');
  if (!q || q.trim().length === 0) return c.json({ results: [], query: '' });

  const category = c.req.query('category') || undefined;
  try {
    const hits = await searchNewsContent(q.trim(), { category, limit: 30 });
    const results = parseHits(hits);
    return c.json({ results, query: q });
  } catch (err) {
    logger.error({ err, q }, 'Search failed');
    return c.json({ error: 'Search failed' }, 500);
  }
});

// Exported function to render search page content (for wrapping in layout)
export async function renderSearchContent(q: string, category: string) {
  let results: SearchResult[] = [];
  let error = '';

  if (q.trim()) {
    try {
      const hits = await searchNewsContent(q.trim(), {
        category: category || undefined,
        limit: 30,
      });
      results = parseHits(hits);

      const dids = [...new Set(results.map(r => r.did))];
      const profiles = await getCachedProfiles(dids);
      for (const r of results) {
        const p = profiles.get(r.did);
        r.authorHandle = p?.handle || r.did;
        r.authorDisplayName = p?.displayName || p?.handle || r.did;
        r.authorAvatar = p?.avatar || null;
      }

      // Fetch video CIDs from database for thumbnails/playback
      const uris = results.map(r => r.uri).filter(Boolean);
      if (uris.length > 0) {
        const { rows: mediaRows } = await db.query<{ uri: string; cid: string | null; thumbnail_cid: string | null }>(
          'SELECT uri, cid, thumbnail_cid FROM media_items WHERE uri = ANY($1)',
          [uris]
        );
        const cidMap = new Map(mediaRows.map(r => [r.uri, { cid: r.cid, thumbnailCid: r.thumbnail_cid }]));
        for (const r of results) {
          const m = cidMap.get(r.uri);
          if (m) {
            r.cid = m.cid;
            r.thumbnailCid = m.thumbnailCid;
          }
        }
      }
    } catch (err) {
      logger.error({ err, q }, 'Search failed');
      error = 'Search temporarily unavailable. Please try again.';
    }
  }

  const categories = [
    { slug: '', label: 'All' },
    { slug: 'politics', label: 'Politics' },
    { slug: 'tech', label: 'Tech' },
    { slug: 'finance', label: 'Finance' },
    { slug: 'news', label: 'Breaking' },
    { slug: 'science', label: 'Science' },
  ];

  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const resultCards = results.map((r, idx) => {
    const bskyLink = atUriToHttps(r.uri);
    const snippet = r.transcript.length > 200 ? r.transcript.slice(0, 200) + '\u2026' : r.transcript;
    const durationSec = r.durationMs ? Math.round(r.durationMs / 1000) : null;
    const durationStr = durationSec ? `${Math.floor(durationSec / 60)}:${(durationSec % 60).toString().padStart(2, '0')}` : '';
    const timeAgo = getTimeAgo(r.createdAt);
    const videoUrl = r.did && r.cid ? `/video/proxy/${encodeURIComponent(r.did)}/${encodeURIComponent(r.cid)}` : '';
    const thumbUrl = r.did && r.thumbnailCid ? `/video/proxy/${encodeURIComponent(r.did)}/${encodeURIComponent(r.thumbnailCid)}` : '';
    const playerId = `srch-player-${idx}`;

    return `
      <div class="bg-slate-900/50 border border-slate-800/60 rounded-2xl overflow-hidden hover:border-slate-700/60 transition-all" x-data="{ playing: false }">
        ${videoUrl ? `
        <!-- Video / Thumbnail -->
        <div class="relative aspect-video bg-black cursor-pointer" @click="playing = true">
          ${thumbUrl ? `<img x-show="!playing" src="${escHtml(thumbUrl)}" class="w-full h-full object-cover" alt="" />` : `<div x-show="!playing" class="w-full h-full bg-slate-800 flex items-center justify-center"><svg class="w-12 h-12 text-slate-600" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>`}
          <!-- Play button overlay -->
          <div x-show="!playing" class="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/20 transition-colors">
            <div class="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-xl">
              <svg class="w-6 h-6 text-slate-900 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </div>
            ${durationStr ? `<span class="absolute bottom-2 right-2 text-xs bg-black/70 text-white px-1.5 py-0.5 rounded">${durationStr}</span>` : ''}
          </div>
          <!-- Inline player -->
          <template x-if="playing">
            <video
              id="${playerId}"
              src="${escHtml(videoUrl)}"
              class="w-full h-full"
              controls
              autoplay
              playsinline
            ></video>
          </template>
        </div>
        ` : ''}
        <div class="p-4">
          <div class="flex items-start gap-3">
            <div class="flex-shrink-0">
              ${r.authorAvatar
                ? `<img src="${escHtml(r.authorAvatar)}" class="w-9 h-9 rounded-full ring-2 ring-slate-800" alt="" />`
                : `<div class="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 text-sm font-bold">${escHtml((r.authorHandle || '?')[0].toUpperCase())}</div>`
              }
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-sm font-semibold text-white truncate">${escHtml(r.authorDisplayName || r.authorHandle || '')}</span>
                <span class="text-xs text-slate-500">@${escHtml(r.authorHandle || '')}</span>
                <span class="text-xs text-slate-600">\u00b7</span>
                <span class="text-xs text-slate-500">${timeAgo}</span>
              </div>
              ${r.postText ? `<p class="text-sm text-slate-300 mb-2">${escHtml(r.postText)}</p>` : ''}
              <p class="text-xs text-slate-500 italic leading-relaxed">"${escHtml(snippet)}"</p>
              <div class="flex flex-wrap gap-1.5 mt-3">
                ${r.storyLabels.map(l =>
                  `<span class="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400/80 border border-amber-500/20">${escHtml(l)}</span>`
                ).join('')}
                <a href="${escHtml(bskyLink)}" target="_blank" rel="noopener" class="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 transition-colors ml-auto">
                  View on Bluesky \u2197
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return html`
    <div class="max-w-3xl mx-auto">
      <form action="/search" method="GET" class="mb-8">
        <div class="flex gap-3">
          <div class="flex-1 relative">
            <svg class="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"></path>
            </svg>
            <input
              type="text"
              name="q"
              value="${q}"
              placeholder="Search news transcripts\u2026"
              class="w-full pl-11 pr-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 text-sm transition-all"
              autofocus
            />
          </div>
          <button
            type="submit"
            class="px-5 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold text-sm hover:from-amber-400 hover:to-orange-400 transition-all shadow-lg shadow-amber-500/20"
          >
            Search
          </button>
        </div>
        <div class="flex gap-2 mt-3">
          ${raw(categories.map(cat => {
            const active = category === cat.slug;
            const href = cat.slug
              ? `/search?q=${encodeURIComponent(q)}&category=${cat.slug}`
              : `/search?q=${encodeURIComponent(q)}`;
            return `<a href="${href}" class="text-xs px-3 py-1.5 rounded-full border transition-all ${
              active
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
            }">${cat.label}</a>`;
          }).join(''))}
        </div>
      </form>

      ${error
        ? html`<div class="text-center py-12 text-rose-400 text-sm">${error}</div>`
        : !q.trim()
          ? html`<div class="text-center py-16">
              <svg class="w-12 h-12 text-slate-700 mx-auto mb-3" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"></path>
              </svg>
              <p class="text-slate-500 text-sm">Search news video transcripts</p>
              <p class="text-slate-600 text-xs mt-1">Find clips by topic, keyword, or phrase</p>
            </div>`
          : results.length === 0
            ? html`<div class="text-center py-16">
                <p class="text-slate-400 text-sm">No results for "<span class="text-white">${q}</span>"</p>
                <p class="text-slate-600 text-xs mt-1">Try different keywords or remove category filter</p>
              </div>`
            : html`
              <p class="text-xs text-slate-500 mb-4">${results.length.toString()} result${results.length !== 1 ? 's' : ''} for "${q}"</p>
              <div class="flex flex-col gap-3">
                ${raw(resultCards)}
              </div>
            `
      }
    </div>
  `;
}

function getTimeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

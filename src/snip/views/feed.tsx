import { html, raw } from 'hono/html';

export interface VideoItem {
  id: number;
  uri: string;
  did: string;
  rkey: string;
  cid: string | null;
  thumbnail_cid: string | null;
  source_url: string;
  alt_text: string | null;
  aspect_ratio: string | null;
  post_text: string | null;
  transcript: string | null;
  language: string | null;
  duration_ms: number | null;
  created_at: string;
  author_handle: string;
  author_display_name: string;
  author_avatar: string | null;
  like_count: number;
  repost_count: number;
}

export function renderVideoCard(item: VideoItem, showTranscript = false) {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const postUrl = `/post/${encodeURIComponent(item.uri)}`;
  const authorUrl = `/profile/${encodeURIComponent(item.did)}`;
  const dateStr = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const hasAudio = item.transcript && item.transcript !== 'silent';

  const videoSrc = item.cid && item.did
    ? `/video/proxy/${encodeURIComponent(item.did)}/${encodeURIComponent(item.cid)}`
    : item.source_url;

  const posterUrl = item.thumbnail_cid && item.did
    ? (item.thumbnail_cid.startsWith('http')
        ? item.thumbnail_cid
        : `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(item.did)}&cid=${encodeURIComponent(item.thumbnail_cid)}`)
    : undefined;

  return html`
    <div class="video-card rounded-2xl p-5 fade-in">
      <div class="flex items-start gap-4">
        <!-- Avatar -->
        <a href="${authorUrl}" class="shrink-0">
          ${item.author_avatar ? html`<img src="${item.author_avatar}" class="w-10 h-10 rounded-full border border-slate-800" />` : html`<div class="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-bold text-slate-400">?</div>`}
        </a>

        <!-- Content -->
        <div class="flex-1 min-w-0">
          <!-- Author Info -->
          <div class="flex items-center justify-between mb-2">
            <div>
              <a href="${authorUrl}" class="text-sm font-bold text-slate-200 hover:text-indigo-400 transition-colors no-underline">
                ${escapeHtml(item.author_display_name || item.author_handle)}
              </a>
              <span class="text-xs text-slate-500 ml-1">@${escapeHtml(item.author_handle)}</span>
            </div>
            <span class="text-[11px] text-slate-500">${dateStr}</span>
          </div>

          <!-- Post Content -->
          ${item.post_text ? html`<p class="text-sm text-slate-300 leading-relaxed mb-3">${escapeHtml(item.post_text)}</p>` : ''}

          <!-- HTML5 Video Player -->
          ${videoSrc ? html`
            <div class="mb-4 rounded-xl overflow-hidden bg-black aspect-video max-w-lg border border-slate-800/80 shadow-2xl relative">
              <video 
                src="${escapeHtml(videoSrc)}" 
                controls 
                preload="metadata" 
                ${posterUrl ? html`poster="${escapeHtml(posterUrl)}"` : ''} 
                class="w-full h-full object-contain"
              ></video>
            </div>
          ` : ''}

          <!-- Transcript Bubble (Only shown on details page) -->
          ${showTranscript && hasAudio ? html`
            <div class="bg-indigo-950/20 border border-indigo-900/30 rounded-xl p-4 mb-3">
              <div class="flex items-center justify-between text-[10px] text-indigo-400/90 font-bold uppercase tracking-wider mb-1.5 select-none">
                <span>🎤 Whisper Transcript (${item.language ?? 'en'})</span>
                ${item.duration_ms ? html`<span>⏱ ${Math.round(item.duration_ms / 1000)}s</span>` : ''}
              </div>
              <p class="text-xs text-slate-300 italic leading-relaxed">"${escapeHtml(item.transcript || '')}"</p>
            </div>
          ` : ''}

          <!-- Footer Actions & Counters -->
          <div class="flex items-center justify-between text-xs text-slate-400">
            <!-- Left: Stats -->
            <div class="flex items-center gap-4 select-none">
              <span class="flex items-center gap-1.5 hover:text-red-400 transition-colors">
                ❤️ <span>${item.like_count}</span>
              </span>
              <span class="flex items-center gap-1.5 hover:text-green-400 transition-colors">
                🔁 <span>${item.repost_count}</span>
              </span>
              <a href="${postUrl}" class="flex items-center gap-1.5 text-slate-400 hover:text-indigo-400 transition-colors no-underline">
                💬 Discussion
              </a>
            </div>
            
            <!-- Right: External Link -->
            <a href="https://bsky.app/profile/${item.author_handle}/post/${item.uri.split('/').pop()}" target="_blank" rel="noopener" class="text-slate-500 hover:text-indigo-400 transition-colors no-underline flex items-center gap-1">
              Bluesky ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function FeedPage({
  items,
  type = 'top',
  q = '',
  category = '',
  trending = []
}: {
  items: VideoItem[];
  type?: string;
  q?: string;
  category?: string;
  trending?: string[];
}) {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const categories = [
    { name: 'Politics', emoji: '🏛️', query: 'election trump harris biden senate vote government' },
    { name: 'Tech & AI', emoji: '💻', query: 'ai technology software robot computer developer coding coding chatgpt nvidia' },
    { name: 'Finance & Business', emoji: '📈', query: 'inflation stocks business economy finance dollars crypto bitcoin money tax' },
    { name: 'Science & Nature', emoji: '🌿', query: 'science nature space nasa planet trail hiking animal bird climate weather' },
    { name: 'Entertainment', emoji: '🎮', query: 'game gaming nintendo pokemon anime music song movie show actor' },
    { name: 'Humor & Memes', emoji: '✨', query: 'funny meme joke comedy laugh fail dog cat puppy' },
  ];

  return html`
    <div class="grid grid-cols-1 lg:grid-cols-4 gap-8">
      <!-- Main Feed Column (3 cols wide on desktop) -->
      <div class="lg:col-span-3 space-y-6">
        <!-- Feed Type Switcher (only show if not searching) -->
        ${!q ? html`
          <div class="flex border-b border-slate-900 pb-3 gap-6 text-sm font-bold text-slate-400">
            <a href="/?type=top" class="no-underline pb-3 -mb-3 transition-colors ${type === 'top' && !category ? 'text-indigo-400 border-b-2 border-indigo-400' : 'hover:text-slate-200'}">Top Videos</a>
            <a href="/?type=latest" class="no-underline pb-3 -mb-3 transition-colors ${type === 'latest' && !category ? 'text-indigo-400 border-b-2 border-indigo-400' : 'hover:text-slate-200'}">Latest</a>
          </div>
        ` : html`
          <div class="flex items-center justify-between border-b border-slate-900 pb-4">
            <div>
              <h2 class="text-lg font-bold text-slate-200">Search Results</h2>
              <p class="text-xs text-slate-500">Found ${items.length} videos matching "${escapeHtml(q)}"</p>
            </div>
            <!-- Custom Feed Button -->
            <button
              hx-post="/api/feeds/create"
              hx-vals='${JSON.stringify({ query: q, name: q, feed_type: 'video' })}'
              hx-target="#create-result"
              hx-swap="innerHTML"
              hx-indicator="#create-spinner"
              class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all cursor-pointer shadow-lg shadow-indigo-600/10 flex items-center gap-1.5"
            >
              ➕ Create Video Feed
            </button>
          </div>
          <div id="create-result" class="mb-4"></div>
          <div id="create-spinner" class="htmx-indicator mb-4">
            <div class="bg-indigo-950/20 border border-indigo-900/30 rounded-xl p-4 text-xs text-indigo-400 flex items-center gap-3">
              <div class="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
              Publishing feed to your Bluesky PDS…
            </div>
          </div>
        `}

        <!-- Category Active Header -->
        ${category ? html`
          <div class="flex items-center justify-between bg-slate-900/30 border border-slate-800/40 rounded-2xl p-4 mb-4 select-none">
            <div class="flex items-center gap-2">
              <span class="text-2xl">${categories.find(c => c.name === category)?.emoji}</span>
              <span class="font-bold text-slate-200">${escapeHtml(category)} Feed</span>
            </div>
            <a href="/" class="text-xs text-slate-500 hover:text-indigo-400 transition-colors no-underline">Clear filter</a>
          </div>
        ` : ''}

        <!-- Feed List -->
        <div class="space-y-4">
          ${items.length > 0 ? items.map(item => renderVideoCard(item)) : html`
            <div class="text-center py-16 bg-slate-900/10 border border-slate-800/40 rounded-3xl p-6">
              <span class="text-3xl block mb-2">🔍</span>
              <p class="text-slate-400 text-sm">No videos found. Try a different topic or category!</p>
            </div>
          `}
        </div>
      </div>

      <!-- Right Sidebar (Smart Categories & Trending) -->
      <div class="space-y-8">
        <!-- Categories -->
        <div class="bg-slate-900/20 border border-slate-800/40 rounded-2xl p-5">
          <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Smart Categories</h3>
          <div class="flex flex-col gap-1">
            ${categories.map(cat => html`
              <a href="/?q=${encodeURIComponent(cat.query)}&category_name=${encodeURIComponent(cat.name)}" class="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-semibold text-slate-300 hover:text-white hover:bg-slate-900/60 border border-transparent hover:border-slate-800/40 transition-all no-underline ${category === cat.name ? 'bg-slate-900 text-indigo-400 border-slate-800' : ''}">
                <span class="text-lg">${cat.emoji}</span>
                <span>${cat.name}</span>
              </a>
            `)}
          </div>
        </div>

        <!-- Trending terms -->
        ${trending.length > 0 ? html`
          <div class="bg-slate-900/20 border border-slate-800/40 rounded-2xl p-5">
            <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">📈 Trending Topics</h3>
            <div class="flex flex-wrap gap-2">
              ${trending.map(word => html`
                <a href="/?q=${encodeURIComponent(word)}" class="bg-slate-900 hover:bg-slate-800 text-indigo-400 border border-slate-800/60 rounded-lg px-2.5 py-1 text-xs font-semibold no-underline transition-colors">
                  #${escapeHtml(word)}
                </a>
              `)}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

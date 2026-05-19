import { html, raw } from 'hono/html';
import { renderContent, shouldShowTitle, safeHostname } from '../lib/contentRenderer.js';

export interface FeedItem {
  uri: string;
  rkey: string;
  author_did: string;
  author_handle: string;
  author_display_name: string;
  author_avatar: string | null;
  title: string | null;
  text_content: string | null;
  site: string | null;
  path: string | null;
  tags: string[];
  published_at: string;
  word_count: number;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderPostCard(item: FeedItem): ReturnType<typeof html> {
  const showTitle = shouldShowTitle(item.title, item.text_content);
  const preview = renderContent(item.text_content || '', 400);
  const isLong = (item.word_count || 0) > 300 || (item.text_content?.length || 0) > 500;
  const canonicalUrl = item.site && item.path
    ? `${item.site.replace(/\/$/, '')}${item.path.startsWith('/') ? '' : '/'}${item.path}`
    : item.site || null;

  return html`
    <article class="bl-post">
      <div class="bl-post-header">
        ${item.author_avatar
          ? html`<img class="bl-avatar" src="${item.author_avatar}" alt="" loading="lazy" />`
          : html`<div class="bl-avatar-ph">${(item.author_display_name || item.author_handle || '?')[0].toUpperCase()}</div>`
        }
        <div class="bl-post-meta">
          <div>
            <a href="/author/${item.author_did}" class="bl-post-author">${item.author_display_name || item.author_handle}</a>
            ${item.author_display_name ? html`<span class="bl-post-handle">@${item.author_handle}</span>` : ''}
          </div>
          <div class="bl-post-time">${timeAgo(item.published_at)}</div>
        </div>
      </div>

      ${showTitle ? html`
        <div class="bl-post-title">
          <a href="/read/${item.author_did}/${item.rkey}">${item.title}</a>
        </div>
      ` : ''}

      <div class="bl-post-body">
        ${raw(preview)}
      </div>

      ${isLong ? html`
        <a href="/read/${item.author_did}/${item.rkey}" class="bl-read-more">Read more →</a>
      ` : ''}

      <div class="bl-post-footer">
        ${canonicalUrl ? html`
          <a href="${canonicalUrl}" class="bl-source" target="_blank">
            ${safeHostname(canonicalUrl)}
          </a>
        ` : ''}
        ${item.tags.slice(0, 3).map(tag => html`<span class="bl-tag">${tag.length > 24 ? tag.substring(0, 24) + '…' : tag}</span>`)}
      </div>
    </article>
  `;
}

export function FeedPage({ items, page, newPostsTs }: { items: FeedItem[]; page: number; newPostsTs: string }) {
  return html`
    <div class="bl-feed">
      <div class="bl-new-posts-header">
        <button class="bl-new-posts" id="newPostsBanner" onclick="loadNewPosts()">
          <span id="newPostsCount">0</span> new posts
        </button>
      </div>

      <div id="feedContainer">
        ${items.length === 0 ? html`
          <div class="bl-empty" id="emptyState">
            <h2>No posts yet</h2>
            <p>The firehose is running. Posts will appear here as they're published.</p>
          </div>
        ` : ''}

        ${items.map(item => renderPostCard(item))}
      </div>

      ${items.length > 0 ? html`
        <div class="bl-pagination">
          ${page > 1 ? html`<a href="/?page=${page - 1}">← Newer</a>` : ''}
          <span>Page ${page}</span>
          ${items.length >= 30 ? html`<a href="/?page=${page + 1}">Older →</a>` : ''}
        </div>
      ` : ''}
    </div>

    <script>
      const PAGE = ${page};
      const banner = document.getElementById('newPostsBanner');
      const countEl = document.getElementById('newPostsCount');
      const feed = document.getElementById('feedContainer');
      const buffered = [];
      let ws;

      function escHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
      }

      function timeAgo(ts) {
        const diff = Date.now() - new Date(ts).getTime();
        const m = Math.floor(diff / 60000);
        if (m < 1) return 'just now';
        if (m < 60) return m + 'm';
        const h = Math.floor(m / 60);
        if (h < 24) return h + 'h';
        const d = Math.floor(h / 24);
        return d + 'd';
      }

      function hostname(url) {
        try { return new URL(url).hostname.replace(/^www\\./, ''); }
        catch { return ''; }
      }

      function buildCard(p) {
        const showTitle = p.title && p.text_content && !p.text_content.toLowerCase().startsWith(p.title.toLowerCase());
        const canon = p.site && p.path
          ? p.site.replace(/\\/$/, '') + (p.path.startsWith('/') ? '' : '/') + p.path
          : p.site || null;
        const avatarHtml = p.author_avatar
          ? '<img class="bl-avatar" src="' + escHtml(p.author_avatar) + '" alt="" loading="lazy" />'
          : '<div class="bl-avatar-ph">' + escHtml((p.author_display_name || p.author_handle || '?')[0].toUpperCase()) + '</div>';
        const handleSpan = p.author_display_name
          ? '<span class="bl-post-handle">@' + escHtml(p.author_handle) + '</span>'
          : '';
        const titleHtml = showTitle
          ? '<div class="bl-post-title"><a href="/read/' + p.author_did + '/' + p.rkey + '">' + escHtml(p.title) + '</a></div>'
          : '';
        const preview = escHtml((p.text_content || '').substring(0, 300) + ((p.text_content || '').length > 300 ? '…' : ''));
        const srcHtml = canon
          ? '<a href="' + escHtml(canon) + '" class="bl-source" target="_blank">' + escHtml(hostname(canon)) + '</a>'
          : '';
        const tags = (p.tags || []).slice(0, 3).map(function(t) {
          const s = t.length > 24 ? t.substring(0, 24) + '…' : t;
          return '<span class="bl-tag">' + escHtml(s) + '</span>';
        }).join('');

        return '<article class="bl-post">'
          + '<div class="bl-post-header">' + avatarHtml
          + '<div class="bl-post-meta"><div>'
          + '<a href="/author/' + p.author_did + '" class="bl-post-author">' + escHtml(p.author_display_name || p.author_handle) + '</a>'
          + handleSpan + '</div>'
          + '<div class="bl-post-time">' + timeAgo(p.published_at) + '</div>'
          + '</div></div>'
          + titleHtml
          + '<div class="bl-post-body"><p>' + preview + '</p></div>'
          + '<div class="bl-post-footer">' + srcHtml + tags + '</div>'
          + '</article>';
      }

      const MAX_BUFFER = 20;
      let newCount = 0;

      function loadNewPosts() {
        if (newCount === 0) return;
        // If we have more than the buffer holds, just reload for a clean state
        if (newCount > MAX_BUFFER || buffered.length === 0) {
          window.location.href = '/';
          return;
        }
        const empty = document.getElementById('emptyState');
        if (empty) empty.remove();
        // Prepend buffered (newest first), limit to MAX_BUFFER
        const toInsert = buffered.slice(-MAX_BUFFER);
        for (let i = toInsert.length - 1; i >= 0; i--) {
          feed.insertAdjacentHTML('afterbegin', buildCard(toInsert[i]));
        }
        // Trim from end to keep 30 visible
        const all = feed.querySelectorAll('.bl-post');
        for (let i = all.length - 1; i >= 30; i--) {
          all[i].remove();
        }
        buffered.length = 0;
        newCount = 0;
        banner.classList.remove('visible');
        countEl.textContent = '0';
        // Scroll to top so user sees newly loaded posts
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      function connectWs() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(proto + '//' + location.host + '/ws/feed');

        ws.onmessage = function(e) {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'batch' && PAGE === 1) {
              newCount += msg.count;
              // Append posts from batch, cap buffer
              const posts = msg.posts || [];
              for (let i = 0; i < posts.length && buffered.length < MAX_BUFFER; i++) {
                buffered.push(posts[i]);
              }
              countEl.textContent = newCount;
              banner.classList.add('visible');
            }
          } catch {}
        };

        ws.onclose = function() {
          if (!dead) setTimeout(connectWs, 3000);
        };

        ws.onerror = function() {
          try { ws.close(); } catch {}
        };
      }

      let dead = false;
      window.addEventListener('beforeunload', function() {
        dead = true;
        if (ws) { try { ws.close(); } catch {} }
      });

      if (PAGE === 1) {
        connectWs();
      }
    </script>
  `;
}

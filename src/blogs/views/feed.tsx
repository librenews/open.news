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
        ${item.tags.map(tag => html`<span class="bl-tag">${tag}</span>`)}
      </div>
    </article>
  `;
}

export function FeedPage({ items, page, newPostsTs }: { items: FeedItem[]; page: number; newPostsTs: string }) {
  return html`
    <div class="bl-feed">
      <button class="bl-new-posts" id="newPostsBanner" onclick="loadNewPosts()">
        <span id="newPostsCount">0</span> new posts
      </button>

      <div id="feedContainer">
        ${items.length === 0 ? html`
          <div class="bl-empty">
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
      // Live new-posts counter
      let lastTs = '${newPostsTs}';
      let newCount = 0;
      const banner = document.getElementById('newPostsBanner');
      const countEl = document.getElementById('newPostsCount');

      function checkNew() {
        fetch('/api/count-since?ts=' + encodeURIComponent(lastTs))
          .then(r => r.json())
          .then(data => {
            if (data.count > 0) {
              newCount = data.count;
              countEl.textContent = newCount;
              banner.classList.add('visible');
            }
          })
          .catch(() => {});
      }

      function loadNewPosts() {
        window.location.href = '/';
      }

      // Poll every 10 seconds
      setInterval(checkNew, 10000);
    </script>
  `;
}

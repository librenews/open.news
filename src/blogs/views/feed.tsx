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
  like_count: number;
  share_count: number;
  user_liked: boolean;
}

export interface TrendingTag {
  tag: string;
  count: number;
}

export interface PopularPost {
  uri: string;
  rkey: string;
  author_did: string;
  author_name: string;
  author_handle: string;
  title: string | null;
  published_at: string;
  like_count: number;
  share_count: number;
}

export interface TopicCluster {
  id: number;
  label: string;
  article_count: number;
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

function renderPostCard(
  item: FeedItem,
  session: { did: string; handle: string } | null,
  followedDids: Set<string>
): ReturnType<typeof html> {
  const showTitle = shouldShowTitle(item.title, item.text_content);
  const preview = renderContent(item.text_content || '', 400);
  const isLong = (item.word_count || 0) > 300 || (item.text_content?.length || 0) > 500;
  const canonicalUrl = item.site && item.path
    ? `${item.site.replace(/\/$/, '')}${item.path.startsWith('/') ? '' : '/'}${item.path}`
    : item.site || null;

  const showFollow = session && session.did !== item.author_did;
  const isFollowing = followedDids.has(item.author_did);
  const liked = item.user_liked;

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
        ${showFollow ? (
          isFollowing
            ? html`<form method="POST" action="/unfollow/${item.author_did}" style="margin-left:auto;flex-shrink:0">
                <button type="submit" class="bl-btn-following"><span>Following</span></button>
              </form>`
            : html`<form method="POST" action="/follow/${item.author_did}" style="margin-left:auto;flex-shrink:0">
                <button type="submit" class="bl-btn-follow">Follow</button>
              </form>`
        ) : ''}
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
        <div class="bl-post-actions">
          ${session ? html`
            <button
              class="bl-action-btn bl-like-btn ${liked ? 'liked' : ''}"
              data-uri="${item.uri}"
              data-liked="${liked ? 'true' : 'false'}"
              data-count="${item.like_count}"
              onclick="toggleLike(this)"
            >
              ${liked ? '♥' : '♡'} <span class="bl-action-count">${item.like_count > 0 ? item.like_count : ''}</span>
            </button>
            <button
              class="bl-action-btn bl-share-btn"
              data-uri="${item.uri}"
              onclick="sharePost(this)"
              title="Share to Bluesky"
            >
              ↗ <span class="bl-action-count">${item.share_count > 0 ? item.share_count : ''}</span>
            </button>
          ` : html`
            <span class="bl-action-btn bl-action-static">♡ ${item.like_count > 0 ? item.like_count : ''}</span>
          `}
        </div>
        ${canonicalUrl ? html`
          <a href="${canonicalUrl}" class="bl-source" target="_blank">
            ${safeHostname(canonicalUrl)}
          </a>
        ` : ''}
        ${item.tags.slice(0, 3).map(tag => html`<a href="/tag/${encodeURIComponent(tag)}" class="bl-tag">${tag.length > 24 ? tag.substring(0, 24) + '…' : tag}</a>`)}
      </div>
    </article>
  `;
}

export function FeedPage({ items, page, newPostsTs, session, followedDids, view = 'trending', trendingTags = [], popularPosts = [], topicClusters = [] }: {
  items: FeedItem[];
  page: number;
  newPostsTs: string;
  session: { did: string; handle: string } | null;
  followedDids: Set<string>;
  view?: 'trending' | 'latest' | 'following';
  trendingTags?: TrendingTag[];
  popularPosts?: PopularPost[];
  topicClusters?: TopicCluster[];
}) {
  return html`
    <div class="bl-feed-layout">

      <!-- Main feed column -->
      <div class="bl-feed-main">

        <!-- Tabs -->
        <div class="bl-tabs">
          <a href="/?view=trending" class="bl-tab ${view === 'trending' ? 'bl-tab-active' : ''}">🔥 Trending</a>
          <a href="/?view=latest" class="bl-tab ${view === 'latest' ? 'bl-tab-active' : ''}">Latest</a>
          ${session ? html`
            <a href="/?view=following" class="bl-tab ${view === 'following' ? 'bl-tab-active' : ''}">Following</a>
          ` : ''}
        </div>

        <!-- Topic clusters -->
        ${topicClusters.length > 0 ? html`
          <div class="bl-topic-wrap">
            <button class="bl-topic-arrow bl-topic-arrow-left" id="topicLeft" onclick="document.getElementById('topicBar').scrollBy({left:-200,behavior:'smooth'})" aria-label="Scroll left">‹</button>
            <div class="bl-topic-bar" id="topicBar">
              ${topicClusters.map(tc => html`
                <a href="/topic/${tc.id}" class="bl-topic-pill">
                  ${tc.label}
                  <span class="bl-topic-count">${tc.article_count}</span>
                </a>
              `)}
            </div>
            <button class="bl-topic-arrow bl-topic-arrow-right" id="topicRight" onclick="document.getElementById('topicBar').scrollBy({left:200,behavior:'smooth'})" aria-label="Scroll right">›</button>
          </div>
          <script>
            (function(){
              var bar=document.getElementById('topicBar'),l=document.getElementById('topicLeft'),r=document.getElementById('topicRight');
              if(!bar)return;
              function u(){
                l.style.opacity=bar.scrollLeft>8?'1':'0';
                l.style.pointerEvents=bar.scrollLeft>8?'auto':'none';
                var atEnd=bar.scrollLeft+bar.clientWidth>=bar.scrollWidth-8;
                r.style.opacity=atEnd?'0':'1';
                r.style.pointerEvents=atEnd?'none':'auto';
              }
              bar.addEventListener('scroll',u);u();
            })();
          </script>
        ` : ''}

        <div class="bl-new-posts-header">
          <button class="bl-new-posts" id="newPostsBanner" onclick="loadNewPosts()">
            <span id="newPostsCount">0</span> new posts
          </button>
        </div>

        <div id="feedContainer">
          ${items.length === 0 ? html`
            <div class="bl-empty" id="emptyState">
              ${view === 'following'
                ? html`<h2>Your following feed is empty</h2><p>Follow some authors to see their posts here.</p><a href="/" class="bl-btn bl-btn-primary" style="margin-top:1rem;display:inline-block;">Browse latest</a>`
                : html`<h2>No posts yet</h2><p>The firehose is running. Posts will appear here as they're published.</p>`
              }
            </div>
          ` : ''}

          ${items.map(item => renderPostCard(item, session, followedDids))}
        </div>

        ${items.length > 0 ? html`
          <div class="bl-pagination">
            ${page > 1 ? html`<a href="/?page=${page - 1}&view=${view}">← Newer</a>` : ''}
            <span>Page ${page}</span>
            ${items.length >= 30 ? html`<a href="/?page=${page + 1}&view=${view}">Older →</a>` : ''}
          </div>
        ` : ''}
      </div>

      <!-- Sidebar -->
      <aside class="bl-sidebar">

        ${popularPosts.length > 0 ? html`
          <div class="bl-sidebar-section">
            <div class="bl-sidebar-title">🔥 Popular</div>
            ${popularPosts.map(p => html`
              <a href="/read/${p.author_did}/${p.rkey}" class="bl-popular-item">
                <div class="bl-popular-title">${p.title || '(untitled)'}</div>
                <div class="bl-popular-meta">
                  @${p.author_handle}
                  · ♥ ${p.like_count}
                  ${p.share_count > 0 ? html` · ↗ ${p.share_count}` : ''}
                </div>
              </a>
            `)}
          </div>
        ` : ''}

        ${trendingTags.length > 0 ? html`
          <div class="bl-sidebar-section">
            <div class="bl-sidebar-title">📌 Trending tags</div>
            <div class="bl-tag-cloud">
              ${trendingTags.slice(0, 20).map(t => html`
                <a href="/tag/${encodeURIComponent(t.tag)}" class="bl-tag-chip">
                  #${t.tag} <span>${t.count}</span>
                </a>
              `)}
            </div>
          </div>
        ` : ''}

      </aside>
    </div>

    <script>
      const PAGE = ${page};
      const VIEW = '${view}';
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
        const preview = escHtml((p.text_content || '').substring(0, 300) + ((p.text_content || '').length > 300 ? '...' : ''));
        const srcHtml = canon
          ? '<a href="' + escHtml(canon) + '" class="bl-source" target="_blank">' + escHtml(hostname(canon)) + '</a>'
          : '';
        const tags = (p.tags || []).slice(0, 3).map(function(t) {
          const s = t.length > 24 ? t.substring(0, 24) + '...' : t;
          return '<a href="/tag/' + encodeURIComponent(t) + '" class="bl-tag">' + escHtml(s) + '</a>';
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
          + '<div class="bl-post-footer"><div class="bl-post-actions"></div>' + srcHtml + tags + '</div>'
          + '</article>';
      }

      const MAX_BUFFER = 20;
      let newCount = 0;

      function loadNewPosts() {
        if (newCount === 0) return;
        if (newCount > MAX_BUFFER || buffered.length === 0) {
          window.location.href = VIEW === 'following' ? '/?view=following' : '/';
          return;
        }
        const empty = document.getElementById('emptyState');
        if (empty) empty.remove();
        const toInsert = buffered.slice(-MAX_BUFFER);
        for (let i = toInsert.length - 1; i >= 0; i--) {
          feed.insertAdjacentHTML('afterbegin', buildCard(toInsert[i]));
        }
        const all = feed.querySelectorAll('.bl-post');
        for (let i = all.length - 1; i >= 30; i--) { all[i].remove(); }
        buffered.length = 0;
        newCount = 0;
        banner.classList.remove('visible');
        countEl.textContent = '0';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      function connectWs() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(proto + '//' + location.host + '/ws/feed');
        ws.onmessage = function(e) {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'batch' && PAGE === 1 && VIEW === 'latest') {
              newCount += msg.count;
              const posts = msg.posts || [];
              for (let i = 0; i < posts.length && buffered.length < MAX_BUFFER; i++) { buffered.push(posts[i]); }
              countEl.textContent = newCount;
              banner.classList.add('visible');
            }
          } catch {}
        };
        ws.onclose = function() { if (!dead) setTimeout(connectWs, 3000); };
        ws.onerror = function() { try { ws.close(); } catch {} };
      }

      let dead = false;
      window.addEventListener('beforeunload', function() {
        dead = true;
        if (ws) { try { ws.close(); } catch {} }
      });

      if (PAGE === 1 && VIEW === 'latest') { connectWs(); }
    </script>
  `;
}

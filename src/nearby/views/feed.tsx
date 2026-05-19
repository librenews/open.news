import { html } from 'hono/html';

interface FeedItem {
  uri: string;
  subject_type: 'document' | 'post';
  title: string | null;
  description: string | null;
  text: string | null;
  site: string | null;
  author_did: string;
  author_handle: string;
  author_avatar: string | null;
  published_at: string;
  confidence: number;
}

interface CityInfo {
  place_id: string;
  name: string;
  parent_name: string | null;
  article_count: number;
  post_count: number;
  account_count: number;
}

interface SidebarCity {
  place_id: string;
  name: string;
  count: number;
}

interface LocalAccount {
  did: string;
  handle: string;
  avatar: string | null;
  display_name: string;
  post_count: number;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + 'd ago';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function bskyPostUrl(uri: string, did: string): string {
  // at://did:plc:xxx/app.bsky.feed.post/rkey → https://bsky.app/profile/did/post/rkey
  const parts = uri.replace('at://', '').split('/');
  const rkey = parts[parts.length - 1];
  return `https://bsky.app/profile/${did}/post/${rkey}`;
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export function CityFeedPage({
  city, items, cities, accounts, page, filter
}: {
  city: CityInfo;
  items: FeedItem[];
  cities: SidebarCity[];
  accounts: LocalAccount[];
  page: number;
  filter: 'all' | 'posts' | 'articles';
}) {
  return html`
    <div class="nb-main">
      <!-- Sidebar -->
      <nav class="nb-sidebar">
        <h3>Browse Cities</h3>
        <ul class="nb-city-list">
          ${cities.map(c => html`
            <li>
              <a href="/city/${c.place_id}" class="${c.place_id === city.place_id ? 'active' : ''}">
                <span>${c.name}</span>
                <span class="count">${c.count >= 1000 ? Math.round(c.count / 1000) + 'k' : c.count}</span>
              </a>
            </li>
          `)}
        </ul>
      </nav>

      <!-- Feed -->
      <main class="nb-feed">
        <div class="nb-feed-header">
          <div>
            <h1>${city.name}</h1>
            <div class="subtitle">
              ${city.article_count.toLocaleString()} articles · ${city.post_count} posts · ${city.account_count} local accounts
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 0.35rem; margin-bottom: 1rem;">
          <a href="/city/${city.place_id}" style="padding: 0.35rem 0.8rem; border-radius: 99px; font-size: 0.78rem; font-weight: 500; border: 1px solid ${filter === 'all' ? 'var(--accent)' : 'var(--border)'}; background: ${filter === 'all' ? 'var(--accent-dim)' : 'transparent'}; color: ${filter === 'all' ? 'var(--accent)' : 'var(--text-muted)'}; text-decoration: none; transition: all 0.15s;">All</a>
          <a href="/city/${city.place_id}?filter=posts" style="padding: 0.35rem 0.8rem; border-radius: 99px; font-size: 0.78rem; font-weight: 500; border: 1px solid ${filter === 'posts' ? 'var(--accent)' : 'var(--border)'}; background: ${filter === 'posts' ? 'var(--accent-dim)' : 'transparent'}; color: ${filter === 'posts' ? 'var(--accent)' : 'var(--text-muted)'}; text-decoration: none; transition: all 0.15s;">🦋 Posts</a>
          <a href="/city/${city.place_id}?filter=articles" style="padding: 0.35rem 0.8rem; border-radius: 99px; font-size: 0.78rem; font-weight: 500; border: 1px solid ${filter === 'articles' ? 'var(--accent)' : 'var(--border)'}; background: ${filter === 'articles' ? 'var(--accent-dim)' : 'transparent'}; color: ${filter === 'articles' ? 'var(--accent)' : 'var(--text-muted)'}; text-decoration: none; transition: all 0.15s;">📄 Articles</a>
        </div>

        ${items.length === 0 ? html`
          <div class="nb-empty">
            <h2>No content yet</h2>
            <p>We're still discovering local content for ${city.name}. Check back soon.</p>
          </div>
        ` : ''}

        ${items.map(item => html`
          <div class="nb-card">
            <div class="nb-card-header">
              ${item.author_avatar
                ? html`<img class="nb-avatar" src="${item.author_avatar}" alt="" />`
                : html`<div class="nb-avatar-placeholder">${(item.author_handle || '?')[0].toUpperCase()}</div>`
              }
              <div class="nb-card-meta">
                <a href="https://bsky.app/profile/${item.author_did}" class="handle" target="_blank">${item.author_handle}</a>
                <div class="time">${timeAgo(item.published_at)}</div>
              </div>
            </div>
            <div class="nb-card-body">
              ${item.subject_type === 'document' ? html`
                <a href="${item.site && item.site.startsWith('http') ? item.site : `https://bsky.app/profile/${item.author_did}`}">
                  ${item.title ? html`<div class="nb-card-title">${item.title}</div>` : ''}
                  ${item.description ? html`<div class="nb-card-description">${item.description.substring(0, 200)}</div>` : ''}
                </a>
              ` : html`
                <a href="${bskyPostUrl(item.uri, item.author_did)}" target="_blank" style="color: var(--text); text-decoration: none;">
                  ${item.text && item.text.trim() ? html`<div>${item.text.substring(0, 300)}</div>` : ''}
                  ${item.title || item.description ? html`
                    <div style="margin-top: ${item.text && item.text.trim() ? '0.5rem' : '0'}; padding: 0.6rem 0.75rem; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-hover);">
                      ${item.title ? html`<div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 0.15rem;">${item.title}</div>` : ''}
                      ${item.description ? html`<div style="font-size: 0.78rem; color: var(--text-muted); line-height: 1.4;">${item.description.substring(0, 160)}</div>` : ''}
                      ${item.site ? html`<div style="font-size: 0.7rem; color: var(--text-dim); margin-top: 0.25rem;">${safeHostname(item.site)}</div>` : ''}
                    </div>
                  ` : ''}
                  ${!item.text?.trim() && !item.title && !item.description ? html`<div style="color: var(--text-dim); font-size: 0.82rem; font-style: italic;">View on Bluesky →</div>` : ''}
                </a>
              `}
            </div>
            <div class="nb-tags">
              ${item.subject_type === 'post'
                ? html`<a href="${bskyPostUrl(item.uri, item.author_did)}" target="_blank" class="nb-tag post" style="text-decoration: none;">🦋 Bluesky post</a>`
                : html`<span class="nb-tag article">📄 Article</span>`
              }
              <span class="nb-tag city">📍 ${city.name}</span>
            </div>
          </div>
        `)}

        ${items.length > 0 ? html`
          <div style="display: flex; justify-content: center; gap: 1rem; padding: 1.5rem 0;">
            ${page > 1 ? html`<a href="/city/${city.place_id}?page=${page - 1}" style="color: var(--accent); font-size: 0.85rem;">← Newer</a>` : ''}
            <span style="color: var(--text-dim); font-size: 0.8rem;">Page ${page}</span>
            ${items.length >= 30 ? html`<a href="/city/${city.place_id}?page=${page + 1}" style="color: var(--accent); font-size: 0.85rem;">Older →</a>` : ''}
          </div>
        ` : ''}
      </main>

      <!-- Right sidebar -->
      <aside class="nb-aside">
        <h3>Local Accounts</h3>
        ${accounts.length === 0 ? html`<p style="font-size: 0.8rem; color: var(--text-dim);">No accounts tagged yet.</p>` : ''}
        ${accounts.map(a => html`
          <a href="https://bsky.app/profile/${a.did}" class="nb-account-card" target="_blank" style="text-decoration: none;">
            ${a.avatar
              ? html`<img class="nb-avatar" src="${a.avatar}" alt="" style="width: 28px; height: 28px;" />`
              : html`<div class="nb-avatar-placeholder" style="width: 28px; height: 28px; font-size: 0.65rem;">${(a.display_name || '?')[0].toUpperCase()}</div>`
            }
            <div>
              <div class="handle">${a.display_name || a.handle}</div>
              <div class="posts">${a.post_count} posts</div>
            </div>
          </a>
        `)}
      </aside>
    </div>
  `;
}

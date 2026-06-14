import { html, raw } from 'hono/html';
import { renderContent, shouldShowTitle, safeHostname } from '../lib/contentRenderer.js';

export interface AuthorProfile {
  did: string;
  handle: string;
  displayName: string;
  avatar: string | null;
  description: string;
  postCount: number;
  sites: string[];
}

export interface AuthorPost {
  uri: string;
  rkey: string;
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

export function AuthorPage({ profile, posts, page, session, followedDids, authorStats, authorRank }: {
  profile: AuthorProfile;
  posts: AuthorPost[];
  page: number;
  session: { did: string; handle: string } | null;
  followedDids: Set<string>;
  authorStats?: { totalLikes: number; totalShares: number; firstPublished: string | null };
  authorRank?: { rank: number; ais: number } | null;
}) {
  const showFollow = session && session.did !== profile.did;
  const isFollowing = followedDids.has(profile.did);
  const memberSince = authorStats?.firstPublished
    ? new Date(authorStats.firstPublished).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
    : null;

  return html`
    <div class="bl-feed" style="padding-top: 1.5rem;">

      <!-- Author header -->
      <div style="display: flex; align-items: flex-start; gap: 1rem; padding-bottom: 1.25rem; border-bottom: 1px solid var(--border); margin-bottom: 0.5rem;">
        ${profile.avatar
          ? html`<img src="${profile.avatar}" alt="" style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; flex-shrink: 0;" />`
          : html`<div style="width: 64px; height: 64px; border-radius: 50%; background: var(--accent-dim); display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 700; color: var(--accent); flex-shrink: 0;">${(profile.displayName || profile.handle || '?')[0].toUpperCase()}</div>`
        }
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 1.2rem; font-weight: 700; letter-spacing: -0.02em;">${profile.displayName || profile.handle}</div>
          <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 0.4rem;">@${profile.handle}</div>
          ${profile.description ? html`<div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 0.5rem;">${profile.description}</div>` : ''}
          ${authorStats ? html`
            <div class="bl-author-stats">
              <div class="bl-author-stat"><strong>${profile.postCount.toLocaleString()}</strong> <span>documents</span></div>
              <div class="bl-author-stat"><strong>${authorStats.totalLikes.toLocaleString()}</strong> <span>likes</span></div>
              <div class="bl-author-stat"><strong>${authorStats.totalShares.toLocaleString()}</strong> <span>shares</span></div>
              ${authorRank ? html`<a href="/leaderboard" class="bl-author-stat bl-author-rank-badge"><strong>#${authorRank.rank}</strong> <span>AIS ${authorRank.ais >= 10 ? authorRank.ais.toFixed(1) : authorRank.ais.toFixed(2)}</span></a>` : ''}
              ${memberSince ? html`<div class="bl-author-stat"><strong>${memberSince}</strong> <span>since</span></div>` : ''}
            </div>
          ` : html`
            <div style="display: flex; gap: 1.25rem; font-size: 0.78rem; color: var(--text-muted);">
              <span><strong style="color: var(--text);">${profile.postCount}</strong> documents</span>
              ${profile.sites.length > 0 ? html`
                <span>${profile.sites.slice(0, 3).map(s => html`<span class="bl-source" style="margin-right: 0.25rem;">${s}</span>`)}</span>
              ` : ''}
            </div>
          `}
        </div>
        <div style="display:flex; gap: 0.5rem; flex-shrink: 0; align-items: center;">
          ${showFollow ? (
            isFollowing
              ? html`<form method="POST" action="/unfollow/${profile.did}">
                  <button type="submit" class="bl-btn-following"><span>Following</span></button>
                </form>`
              : html`<form method="POST" action="/follow/${profile.did}">
                  <button type="submit" class="bl-btn-follow">Follow</button>
                </form>`
          ) : ''}
          <a href="https://bsky.app/profile/${profile.did}" target="_blank" class="bl-btn bl-btn-outline">
            View on Bluesky
          </a>
        </div>
      </div>

      <!-- Posts -->
      ${posts.length === 0 ? html`
        <div class="bl-empty">
          <h2>No documents yet</h2>
          <p>This author hasn't published any site.standard.document records.</p>
        </div>
      ` : ''}

      ${posts.map(post => {
        const showTitle = shouldShowTitle(post.title, post.text_content);
        const preview = renderContent(post.text_content || '', 400);
        const isLong = (post.word_count || 0) > 300 || (post.text_content?.length || 0) > 500;
        const canonicalUrl = post.site && post.path
          ? `${post.site.replace(/\/$/, '')}${post.path.startsWith('/') ? '' : '/'}${post.path}`
          : post.site || null;

        return html`
          <article class="bl-post">
            ${showTitle ? html`
              <div class="bl-post-title">
                <a href="/read/${profile.did}/${post.rkey}">${post.title}</a>
              </div>
            ` : ''}
            <div class="bl-post-body">
              ${raw(preview)}
            </div>
            ${isLong ? html`<a href="/read/${profile.did}/${post.rkey}" class="bl-read-more">Read more →</a>` : ''}
            <div class="bl-post-footer">
              <span class="bl-post-time">${timeAgo(post.published_at)}</span>
              ${canonicalUrl ? html`<a href="${canonicalUrl}" class="bl-source" target="_blank">${safeHostname(canonicalUrl)}</a>` : ''}
              ${post.tags.slice(0, 3).map(tag => html`<span class="bl-tag">${tag.length > 24 ? tag.substring(0, 24) + '…' : tag}</span>`)}
            </div>
          </article>
        `;
      })}

      ${posts.length > 0 ? html`
        <div class="bl-pagination">
          ${page > 1 ? html`<a href="/author/${profile.did}?page=${page - 1}">← Newer</a>` : ''}
          <span>Page ${page}</span>
          ${posts.length >= 30 ? html`<a href="/author/${profile.did}?page=${page + 1}">Older →</a>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

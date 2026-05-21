import { html } from 'hono/html';

export interface SubscriptionItem {
  did: string;
  handle: string;
  displayName: string;
  avatar: string;
  postCount: number;
}

export function SubscriptionsPage({ subs, page, totalPages, totalCount }: {
  subs: SubscriptionItem[];
  page: number;
  totalPages: number;
  totalCount: number;
}) {
  return html`
    <div class="bl-feed" style="padding-top: 1.5rem;">

      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.25rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border);">
        <div>
          <h1 style="font-size: 1.3rem; font-weight: 700; letter-spacing: -0.03em; margin: 0;">Subscriptions</h1>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.2rem;">${totalCount} author${totalCount !== 1 ? 's' : ''} followed</div>
        </div>
      </div>

      ${subs.length === 0 ? html`
        <div class="bl-empty">
          <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">📡</div>
          <h2>No subscriptions yet</h2>
          <p>Follow authors from their profile pages to see them here.</p>
          <p style="margin-top: 1rem;"><a href="/">← Browse the feed</a></p>
        </div>
      ` : ''}

      ${subs.map(sub => html`
        <div class="bl-sub-card">
          <a href="/author/${sub.did}" class="bl-sub-left">
            ${sub.avatar
              ? html`<img class="bl-sub-avatar" src="${sub.avatar}" alt="" loading="lazy" />`
              : html`<div class="bl-sub-avatar-ph">${(sub.displayName || sub.handle || '?')[0].toUpperCase()}</div>`
            }
            <div class="bl-sub-info">
              <span class="bl-sub-name">${sub.displayName || sub.handle}</span>
              <span class="bl-sub-handle">@${sub.handle}</span>
            </div>
          </a>
          <div class="bl-sub-meta">
            <span class="bl-sub-count">${sub.postCount} post${sub.postCount !== 1 ? 's' : ''}</span>
            <form method="POST" action="/unfollow/${sub.did}" style="margin:0;">
              <button type="submit" class="bl-sub-unfollow">Unfollow</button>
            </form>
          </div>
        </div>
      `)}

      ${totalPages > 1 ? html`
        <div class="bl-pagination">
          ${page > 1 ? html`<a href="/subscriptions?page=${page - 1}">← Previous</a>` : ''}
          <span>Page ${page} of ${totalPages}</span>
          ${page < totalPages ? html`<a href="/subscriptions?page=${page + 1}">Next →</a>` : ''}
        </div>
      ` : ''}
    </div>

    <style>
      .bl-sub-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.85rem 0;
        border-bottom: 1px solid var(--border);
        transition: opacity 0.15s;
      }
      .bl-sub-card:last-of-type { border-bottom: none; }
      .bl-sub-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
        flex: 1;
        text-decoration: none;
        color: inherit;
      }
      .bl-sub-left:hover { opacity: 0.8; }
      .bl-sub-avatar {
        width: 42px;
        height: 42px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
      }
      .bl-sub-avatar-ph {
        width: 42px;
        height: 42px;
        border-radius: 50%;
        background: var(--accent-dim);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--accent);
        font-size: 1rem;
        font-weight: 700;
        flex-shrink: 0;
      }
      .bl-sub-info {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        min-width: 0;
      }
      .bl-sub-name {
        font-weight: 600;
        font-size: 0.92rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bl-sub-handle {
        font-size: 0.78rem;
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .bl-sub-meta {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-shrink: 0;
        margin-left: 1rem;
      }
      .bl-sub-count {
        font-size: 0.75rem;
        color: var(--text-muted);
        white-space: nowrap;
      }
      .bl-sub-unfollow {
        background: none;
        border: 1px solid var(--border);
        padding: 0.3rem 0.75rem;
        border-radius: 99px;
        cursor: pointer;
        font-family: var(--font);
        font-size: 0.78rem;
        font-weight: 500;
        color: var(--text-muted);
        transition: all 0.15s;
      }
      .bl-sub-unfollow:hover {
        border-color: var(--red);
        color: var(--red);
      }
    </style>
  `;
}

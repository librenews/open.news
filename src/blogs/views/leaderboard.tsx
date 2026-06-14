import { html, raw } from 'hono/html';

export interface RankedAuthor {
  rank: number;
  did: string;
  handle: string;
  displayName: string;
  avatar: string | null;
  ais: number;
  engagement_vel: number;
  content_momentum: number;
  quality_signal: number;
  consistency: number;
  network_score: number;
  freshness_decay: number;
  article_count_90d: number;
  total_likes: number;
  total_shares: number;
  follower_count: number;
  last_published: string | null;
}

function formatScore(n: number): string {
  if (n >= 100) return Math.round(n).toLocaleString();
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function rankBadge(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

function signalBar(value: number, max: number, color: string) {
  const pct = Math.min((value / Math.max(max, 0.001)) * 100, 100);
  return raw(`<div class="bl-signal-bar"><div class="bl-signal-fill" style="width:${pct}%;background:${color}"></div></div>`);
}

export function LeaderboardPage({ authors, computedAt }: {
  authors: RankedAuthor[];
  computedAt: string | null;
}) {
  // Find max values for signal bars
  const maxEv = Math.max(...authors.map(a => a.engagement_vel), 1);
  const maxCm = Math.max(...authors.map(a => a.content_momentum), 1);
  const maxQs = Math.max(...authors.map(a => a.quality_signal), 1);

  return html`
    <div class="bl-feed" style="padding-top: 1.5rem; max-width: 780px;">
      <div class="bl-leaderboard-header">
        <h1>Top Authors</h1>
        <p>Ranked by Author Influence Score — a composite of engagement velocity, content momentum, quality signal, consistency, and network influence, multiplied by freshness decay.</p>
        ${computedAt ? html`<span class="bl-lb-updated">Updated ${timeAgo(computedAt)}</span>` : ''}
      </div>

      ${authors.length === 0 ? html`
        <div class="bl-empty">
          <h2>No rankings yet</h2>
          <p>The ranking job hasn't run yet. Check back soon.</p>
        </div>
      ` : ''}

      <div class="bl-lb-list">
        ${authors.map(a => html`
          <a href="/author/${a.did}" class="bl-lb-row">
            <div class="bl-lb-rank ${a.rank <= 3 ? 'bl-lb-rank-top' : ''}">${rankBadge(a.rank)}</div>
            <div class="bl-lb-avatar">
              ${a.avatar
                ? html`<img src="${a.avatar}" alt="" />`
                : html`<div class="bl-lb-avatar-ph">${(a.displayName || a.handle || '?')[0].toUpperCase()}</div>`
              }
            </div>
            <div class="bl-lb-info">
              <div class="bl-lb-name">${a.displayName || a.handle}</div>
              <div class="bl-lb-handle">@${a.handle}</div>
            </div>
            <div class="bl-lb-signals">
              <div class="bl-lb-signal" title="Engagement velocity">
                <span class="bl-lb-signal-label">EV</span>
                ${signalBar(a.engagement_vel, maxEv, '#6366f1')}
              </div>
              <div class="bl-lb-signal" title="Content momentum">
                <span class="bl-lb-signal-label">CM</span>
                ${signalBar(a.content_momentum, maxCm, '#10b981')}
              </div>
              <div class="bl-lb-signal" title="Quality signal">
                <span class="bl-lb-signal-label">QS</span>
                ${signalBar(a.quality_signal, maxQs, '#f59e0b')}
              </div>
            </div>
            <div class="bl-lb-meta">
              <span class="bl-lb-stat" title="Articles (90d)">${a.article_count_90d} docs</span>
              <span class="bl-lb-stat" title="Likes">♥ ${a.total_likes}</span>
              <span class="bl-lb-stat" title="Last published">${timeAgo(a.last_published)}</span>
            </div>
            <div class="bl-lb-score">
              <div class="bl-lb-ais">${formatScore(a.ais)}</div>
              <div class="bl-lb-ais-label">AIS</div>
            </div>
          </a>
        `)}
      </div>
    </div>
  `;
}

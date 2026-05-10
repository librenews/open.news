/** @jsxImportSource hono/jsx */
import { BASE_STYLES, HEADER_STYLES, NAV_STYLES, FontLinks, TopHeader, LeftNav } from './partials.js';
import type { UserProfile } from './partials.js';

export interface MyCitation {
  id: number;
  url: string;
  title: string | null;
  topic: string | null;
  excerpt: string | null;
  status: string;
  created_at: string;
  article_rkey: string | null;
  endorsements: number;
  agent_notes: string | null;
}

const PAGE_STYLES = `
.center-content { flex: 1; min-width: 0; border-right: 1px solid var(--border); border-left: 1px solid var(--border); }
.page-header { padding: 2rem 2rem 1.5rem; border-bottom: 1px solid var(--border); }
.page-header h1 { font-family: var(--font-body); font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; letter-spacing: -0.02em; }
.page-header p { font-size: 0.9rem; color: var(--text-secondary); line-height: 1.6; }
.stats-row { display: flex; gap: 2rem; margin-top: 1rem; }
.stat { display: flex; flex-direction: column; }
.stat-value { font-size: 1.5rem; font-weight: 800; font-family: var(--font-sans); letter-spacing: -0.02em; }
.stat-label { font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.my-citations-list { padding: 0; }
.my-citation { display: flex; gap: 1rem; padding: 1rem 2rem; border-bottom: 1px solid var(--border); align-items: flex-start; transition: background 0.15s; }
.my-citation:hover { background: var(--bg-secondary); }
.my-citation-status { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; padding: 0.15rem 0.5rem; border-radius: 99px; flex-shrink: 0; margin-top: 0.15rem; }
.my-citation-status[data-status="pending"] { background: rgba(245,158,11,0.1); color: #f59e0b; }
.my-citation-status[data-status="accepted"] { background: rgba(16,185,129,0.1); color: #10b981; }
.my-citation-status[data-status="rejected"] { background: rgba(239,68,68,0.1); color: #ef4444; }
.my-citation-body { flex: 1; min-width: 0; }
.my-citation-title { font-family: var(--font-sans); font-size: 0.9rem; font-weight: 600; color: var(--accent); text-decoration: none; word-break: break-word; }
.my-citation-title:hover { text-decoration: underline; }
.my-citation-excerpt { font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem; line-height: 1.5; }
.my-citation-meta { font-size: 0.7rem; color: var(--text-muted); margin-top: 0.35rem; font-family: var(--font-sans); display: flex; gap: 0.75rem; align-items: center; }
.my-citation-endorsements { display: flex; align-items: center; gap: 0.25rem; color: #10b981; font-weight: 600; }
.my-citation-article { color: var(--accent); text-decoration: none; font-weight: 600; }
.my-citation-article:hover { text-decoration: underline; }
.empty-state { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
.empty-state h3 { font-family: var(--font-body); font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 0.5rem; }
.empty-state a { display: inline-block; margin-top: 1rem; padding: 0.5rem 1.5rem; background: var(--accent); color: var(--bg); border-radius: 99px; text-decoration: none; font-size: 0.85rem; font-weight: 600; }
.my-citation-reason { font-size: 0.75rem; color: #ef4444; margin-top: 0.35rem; padding: 0.4rem 0.6rem; background: rgba(239,68,68,0.05); border-radius: 6px; border-left: 2px solid rgba(239,68,68,0.3); line-height: 1.5; }
`;

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'Just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function MyCitationsPage({
  citations, profile, stats, botDid,
}: {
  citations: MyCitation[];
  profile: UserProfile;
  stats: { total: number; accepted: number; pending: number; totalEndorsements: number };
  botDid: string;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>My Citations — Centipedia</title>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <FontLinks />
        <style dangerouslySetInnerHTML={{__html: BASE_STYLES + HEADER_STYLES + NAV_STYLES + PAGE_STYLES}} />
      </head>
      <body>
        <TopHeader profile={profile} />
        <div class="app-shell">
          <LeftNav active="" profile={profile} />
          <main class="center-content">
            <div class="page-header">
              <h1>My Citations</h1>
              <p>Sources you've submitted to the encyclopedia.</p>
              <div class="stats-row">
                <div class="stat">
                  <span class="stat-value">{stats.total}</span>
                  <span class="stat-label">Submitted</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{stats.accepted}</span>
                  <span class="stat-label">Accepted</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{stats.pending}</span>
                  <span class="stat-label">Pending</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{stats.totalEndorsements}</span>
                  <span class="stat-label">Endorsements</span>
                </div>
              </div>
            </div>

            {citations.length === 0 ? (
              <div class="empty-state">
                <h3>No citations yet</h3>
                <p>Submit your first source to start contributing.</p>
                <a href="/submit">Submit a Citation</a>
              </div>
            ) : (
              <div class="my-citations-list">
                {citations.map(c => (
                  <div class="my-citation">
                    <div class="my-citation-status" data-status={c.status}>{c.status}</div>
                    <div class="my-citation-body">
                      <a href={c.url} target="_blank" rel="noopener" class="my-citation-title">{c.title || c.url}</a>
                      {c.excerpt && <div class="my-citation-excerpt">{c.excerpt}</div>}
                      {c.status === 'rejected' && c.agent_notes && (
                        <div class="my-citation-reason">⚠ {c.agent_notes}</div>
                      )}
                      <div class="my-citation-meta">
                        {c.topic && <span>{c.topic}</span>}
                        <span>{timeAgo(c.created_at)}</span>
                        {c.endorsements > 0 && (
                          <span class="my-citation-endorsements">
                            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                            {c.endorsements}
                          </span>
                        )}
                        {c.article_rkey && (
                          <a href={`/article/${c.article_rkey}`} class="my-citation-article">→ View article</a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </body>
    </html>
  );
}

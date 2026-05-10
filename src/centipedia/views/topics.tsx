/** @jsxImportSource hono/jsx */
import { BASE_STYLES, HEADER_STYLES, NAV_STYLES, FontLinks, TopHeader, LeftNav } from './partials.js';
import type { UserProfile } from './partials.js';

export interface TopicSummary {
  topic: string;
  count: number;
  latest: string;
}

const PAGE_STYLES = `
.center-content { flex: 1; min-width: 0; border-right: 1px solid var(--border); border-left: 1px solid var(--border); }
.page-header { padding: 2rem 2rem 1.5rem; border-bottom: 1px solid var(--border); }
.page-header h1 { font-family: var(--font-body); font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; letter-spacing: -0.02em; }
.page-header p { font-size: 0.9rem; color: var(--text-secondary); line-height: 1.6; }
.topics-grid { padding: 1.5rem 2rem; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; }
.topic-card { padding: 1.25rem; border: 1px solid var(--border); border-radius: 12px; transition: all 0.15s; text-decoration: none; color: inherit; display: block; }
.topic-card:hover { border-color: var(--text-muted); background: var(--bg-secondary); transform: translateY(-1px); }
.topic-name { font-family: var(--font-sans); font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem; text-transform: capitalize; }
.topic-meta { font-size: 0.75rem; color: var(--text-muted); display: flex; gap: 1rem; }
.topic-meta strong { color: var(--text-secondary); }
.empty-topics { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
.empty-topics h3 { font-family: var(--font-body); font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 0.5rem; }
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

export function TopicsPage({
  topics, profile,
}: {
  topics: TopicSummary[];
  profile?: UserProfile | null;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Topics — Centipedia</title>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <FontLinks />
        <style dangerouslySetInnerHTML={{__html: BASE_STYLES + HEADER_STYLES + NAV_STYLES + PAGE_STYLES}} />
      </head>
      <body>
        <TopHeader profile={profile} />
        <div class="app-shell">
          <LeftNav active="topics" profile={profile} />
          <main class="center-content">
            <div class="page-header">
              <h1>Topics</h1>
              <p>Browse articles by topic. Topics are auto-categorized from submitted citations.</p>
            </div>
            {topics.length === 0 ? (
              <div class="empty-topics">
                <h3>No topics yet</h3>
                <p>Topics will appear as citations are submitted and categorized.</p>
                <a href="/submit" style="display: inline-block; margin-top: 1rem; padding: 0.5rem 1.5rem; background: var(--accent); color: var(--bg); border-radius: 99px; text-decoration: none; font-size: 0.85rem; font-weight: 600;">Submit a Citation</a>
              </div>
            ) : (
              <div class="topics-grid">
                {topics.map(t => (
                  <a href={`/topics/${encodeURIComponent(t.topic)}`} class="topic-card">
                    <div class="topic-name">{t.topic}</div>
                    <div class="topic-meta">
                      <span><strong>{t.count}</strong> citations</span>
                      <span>Latest: {timeAgo(t.latest)}</span>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </main>
        </div>
      </body>
    </html>
  );
}

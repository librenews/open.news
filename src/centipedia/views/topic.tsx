/** @jsxImportSource hono/jsx */
import { BASE_STYLES, HEADER_STYLES, NAV_STYLES, FontLinks, TopHeader, LeftNav } from './partials.js';
import type { UserProfile } from './partials.js';

export interface TopicCitation {
  id: number;
  url: string;
  title: string | null;
  status: string;
  excerpt: string | null;
  endorsements: number;
  submitted_by: string;
  submitter_handle: string | null;
  article_rkey: string | null;
  created_at: string;
  userEndorsed?: boolean;
}

export interface TopicArticle {
  rkey: string;
  title: string;
  description: string | null;
  word_count: number;
  published_at: string | null;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
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

const PAGE_STYLES = `
.center-content { flex: 1; min-width: 0; padding: 2rem 1.75rem; border-left: 1px solid var(--border); }

.topic-header { margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--border); }
.topic-title { font-family: var(--font-sans); font-size: 1.8rem; font-weight: 800; letter-spacing: -0.03em; margin-bottom: 0.5rem; }
.topic-stats { display: flex; gap: 1.5rem; font-size: 0.85rem; color: var(--text-muted); }
.topic-stats strong { color: var(--text-main); font-weight: 600; }
.topic-submit-btn { display: inline-flex; align-items: center; gap: 0.35rem; margin-top: 1rem; padding: 0.5rem 1.25rem; background: var(--accent); color: var(--bg); border: none; border-radius: 99px; font-size: 0.85rem; font-weight: 600; font-family: var(--font-sans); cursor: pointer; text-decoration: none; transition: opacity 0.15s; }
.topic-submit-btn:hover { opacity: 0.85; }

.topic-article-card { padding: 1.25rem; border: 1px solid var(--border); border-radius: 10px; margin-bottom: 1.5rem; transition: border-color 0.15s; }
.topic-article-card:hover { border-color: var(--text-muted); }
.topic-article-card a { text-decoration: none; color: inherit; }
.topic-article-title { font-family: var(--font-body); font-size: 1.2rem; font-weight: 700; line-height: 1.4; margin-bottom: 0.35rem; }
.topic-article-desc { font-family: var(--font-body); font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 0.5rem; }
.topic-article-meta { font-size: 0.75rem; color: var(--text-muted); display: flex; gap: 0.75rem; }

.section-title { font-family: var(--font-sans); font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 1rem; margin-top: 2rem; }

.citation-card { display: flex; gap: 0.75rem; padding: 0.85rem 0; border-bottom: 1px solid var(--border); align-items: flex-start; }
.citation-card:last-child { border-bottom: none; }
.citation-endorse { display: flex; flex-direction: column; align-items: center; gap: 0.1rem; background: none; border: 1px solid var(--border); border-radius: 6px; padding: 0.35rem 0.45rem; cursor: pointer; color: var(--text-muted); transition: all 0.15s; flex-shrink: 0; }
.citation-endorse:hover { border-color: #10b981; color: #10b981; }
.citation-endorse.endorsed { border-color: #10b981; background: rgba(16,185,129,0.08); color: #10b981; }
.citation-endorse-count { font-size: 0.65rem; font-weight: 700; font-family: var(--font-sans); }
.citation-body { flex: 1; min-width: 0; }
.citation-title { font-size: 0.9rem; font-weight: 600; color: var(--accent); text-decoration: none; word-break: break-word; display: block; }
.citation-title:hover { text-decoration: underline; }
.citation-excerpt { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.5; margin-top: 0.25rem; }
.citation-meta { font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem; font-family: var(--font-sans); display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
.citation-domain { padding: 0.15rem 0.4rem; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4px; font-size: 0.65rem; cursor: pointer; transition: all 0.15s; }
.citation-domain:hover { border-color: #10b981; color: #10b981; }
.citation-domain.domain-endorsed { border-color: #10b981; background: rgba(16,185,129,0.08); color: #10b981; }
.citation-status { font-size: 0.55rem; font-weight: 700; text-transform: uppercase; padding: 0.1rem 0.35rem; border-radius: 99px; }
.citation-status[data-status="accepted"] { background: rgba(16,185,129,0.1); color: #10b981; }
.citation-status[data-status="pending"] { background: rgba(245,158,11,0.1); color: #f59e0b; }

.empty-state { text-align: center; padding: 3rem 2rem; color: var(--text-muted); }
.empty-state h3 { font-family: var(--font-body); font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 0.5rem; }
`;

export function TopicPage({
  topic, citations, articles, sessionProfile, botDid,
}: {
  topic: string;
  citations: TopicCitation[];
  articles: TopicArticle[];
  sessionProfile?: UserProfile | null;
  botDid: string;
}) {
  const acceptedCount = citations.filter(c => c.status === 'accepted').length;
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{topic} — Centipedia</title>
        <meta name="description" content={`Explore ${citations.length} citations and ${articles.length} articles about ${topic} on Centipedia.`} />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <FontLinks />
        <style dangerouslySetInnerHTML={{__html: BASE_STYLES + HEADER_STYLES + NAV_STYLES + PAGE_STYLES}} />
      </head>
      <body>
        <TopHeader profile={sessionProfile} />

        <div class="app-shell">
          <LeftNav active="" profile={sessionProfile} />

          <main class="center-content">
            <div class="topic-header">
              <h1 class="topic-title">{topic}</h1>
              <div class="topic-stats">
                <span><strong>{citations.length}</strong> citation{citations.length !== 1 ? 's' : ''}</span>
                <span><strong>{acceptedCount}</strong> accepted</span>
                <span><strong>{articles.length}</strong> article{articles.length !== 1 ? 's' : ''}</span>
              </div>
              <a href={`/submit?topic=${encodeURIComponent(topic)}`} class="topic-submit-btn">
                + Add Citation
              </a>
            </div>

            {/* Articles for this topic */}
            {articles.length > 0 && (
              <div>
                <h2 class="section-title">Articles</h2>
                {articles.map(a => {
                  const minRead = Math.max(1, Math.ceil(a.word_count / 200));
                  return (
                    <div class="topic-article-card">
                      <a href={`/post/${botDid}/${a.rkey}`}>
                        <div class="topic-article-title">{a.title}</div>
                        {a.description && (
                          <div class="topic-article-desc">
                            {a.description.length > 200 ? a.description.substring(0, 200) + '…' : a.description}
                          </div>
                        )}
                        <div class="topic-article-meta">
                          <span>{minRead} min read</span>
                          <span>·</span>
                          <span>{a.word_count} words</span>
                          {a.published_at && <span>· {timeAgo(a.published_at)}</span>}
                        </div>
                      </a>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Citations */}
            <h2 class="section-title">Citations ({citations.length})</h2>
            {citations.length === 0 ? (
              <div class="empty-state">
                <h3>No citations for this topic yet</h3>
                <p>Be the first to submit a source about {topic}.</p>
              </div>
            ) : (
              citations.map(c => {
                let domain = '';
                try { domain = new URL(c.url).hostname.replace(/^www\./, ''); } catch {}
                return (
                  <div class="citation-card">
                    <button
                      class={`citation-endorse ${c.userEndorsed ? 'endorsed' : ''}`}
                      data-citation-id={c.id}
                      title="Endorse this citation"
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 19V5M5 12l7-7 7 7" />
                      </svg>
                      <span class="citation-endorse-count">{c.endorsements || ''}</span>
                    </button>
                    <div class="citation-body">
                      <a href={c.url} target="_blank" rel="noopener noreferrer" class="citation-title">{c.title || c.url}</a>
                      {c.excerpt && <div class="citation-excerpt">{c.excerpt.length > 150 ? c.excerpt.substring(0, 150) + '…' : c.excerpt}</div>}
                      <div class="citation-meta">
                        <span class="citation-status" data-status={c.status}>{c.status}</span>
                        {domain && (
                          <button class="citation-domain" data-domain={domain} title={`Endorse ${domain} as a trusted source`}>
                            {domain}
                          </button>
                        )}
                        <span>{timeAgo(c.created_at)}</span>
                        {c.submitter_handle && <span>by <a href={`/profile/${c.submitter_handle}`} style="color: var(--text-muted); text-decoration: none;">{c.submitter_handle}</a></span>}
                        {c.article_rkey && (
                          <a href={`/post/${botDid}/${c.article_rkey}`} style="color: var(--accent); text-decoration: none; font-weight: 600;">→ Article</a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </main>
        </div>

        <script dangerouslySetInnerHTML={{__html: `
          // Citation endorsement
          document.querySelectorAll('.citation-endorse').forEach(btn => {
            btn.addEventListener('click', async () => {
              const citationId = Number(btn.dataset.citationId);
              try {
                const res = await fetch('/api/endorse/citation', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ citationId })
                });
                if (res.status === 401) { location.href = '/login'; return; }
                const data = await res.json();
                if (res.ok) {
                  btn.classList.toggle('endorsed', data.endorsed);
                  btn.querySelector('.citation-endorse-count').textContent = data.count || '';
                }
              } catch(e) {}
            });
          });

          // Domain endorsement
          document.querySelectorAll('.citation-domain').forEach(btn => {
            btn.addEventListener('click', async () => {
              const domain = btn.dataset.domain;
              try {
                const res = await fetch('/api/endorse/domain', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ domain, topic: '${topic.replace(/'/g, "\\'")}' })
                });
                if (res.status === 401) { location.href = '/login'; return; }
                const data = await res.json();
                if (res.ok) {
                  btn.classList.toggle('domain-endorsed', data.endorsed);
                }
              } catch(e) {}
            });
          });
        `}} />
      </body>
    </html>
  );
}

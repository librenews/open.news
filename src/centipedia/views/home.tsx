/** @jsxImportSource hono/jsx */
import { BASE_STYLES, HEADER_STYLES, NAV_STYLES, FontLinks, TopHeader, LeftNav } from './partials.js';
import type { UserProfile } from './partials.js';

export interface CentipediaCitation {
  id: number;
  url: string;
  title: string | null;
  submitted_by: string | null;
  topic: string | null;
  status: string;
  created_at: string;
  endorsements: number;
  userEndorsed: boolean;
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
/* Hero */
.hero { padding: 3rem 2rem 2rem; border-bottom: 1px solid var(--border); }
.hero-badge { font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.75rem; }
.hero h1 { font-family: var(--font-body); font-size: 2rem; font-weight: 700; line-height: 1.3; margin-bottom: 0.75rem; letter-spacing: -0.02em; }
.hero-sub { font-size: 0.95rem; color: var(--text-secondary); line-height: 1.6; max-width: 480px; margin-bottom: 1.5rem; }
.hero-stats { display: flex; gap: 2rem; }
.stat { font-size: 0.8rem; color: var(--text-muted); }
.stat-num { font-weight: 700; color: var(--text-main); font-size: 1.1rem; margin-right: 0.25rem; }

/* Submit section */
.submit-section { padding: 1.5rem 2rem; border-bottom: 1px solid var(--border); }
.section-title { font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 0.25rem; }
.section-desc { font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 1rem; }
.submit-form { display: flex; flex-direction: column; gap: 0.5rem; }
.submit-form input { padding: 0.6rem 0.85rem; border: 1px solid var(--border); border-radius: 8px; font-size: 0.85rem; font-family: var(--font-sans); background: var(--bg); color: var(--text-main); outline: none; transition: border-color 0.15s; }
.submit-form input:focus { border-color: var(--text-muted); }
.submit-form input::placeholder { color: var(--text-muted); }
.submit-form button { align-self: flex-start; padding: 0.5rem 1.5rem; background: var(--accent); color: var(--bg); border: none; border-radius: 99px; font-size: 0.8rem; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: background 0.15s; }
.submit-form button:hover { background: var(--accent-hover); }
.submit-form button:disabled { opacity: 0.5; cursor: not-allowed; }

/* Citations */
.citations-section { padding: 1.5rem 2rem; }
.citations-list { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.75rem; }
.citation-card { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; border-radius: 8px; background: var(--bg-secondary); transition: background 0.15s; flex-wrap: wrap; }
.citation-card:hover { background: var(--border); }
.citation-status { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; padding: 0.15rem 0.5rem; border-radius: 99px; background: var(--text-muted); color: var(--bg); }
.citation-status[data-status="pending"] { background: #f59e0b; }
.citation-status[data-status="processing"] { background: #3b82f6; }
.citation-status[data-status="accepted"] { background: #10b981; }
.citation-url { font-size: 0.85rem; color: var(--text-main); text-decoration: none; font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.citation-url:hover { text-decoration: underline; }
.citation-topic { font-size: 0.7rem; background: var(--border); padding: 0.1rem 0.5rem; border-radius: 99px; color: var(--text-secondary); }
.citation-time { font-size: 0.7rem; color: var(--text-muted); }
.empty-state { text-align: center; padding: 3rem 2rem; color: var(--text-muted); }

/* Center */
.center-content { flex: 1; min-width: 0; border-right: 1px solid var(--border); border-left: 1px solid var(--border); }

/* How it works */
.how-it-works { display: flex; flex-direction: column; gap: 1rem; }
.how-step { display: flex; gap: 0.75rem; align-items: flex-start; }
.step-num { width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: var(--bg); font-size: 0.7rem; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.how-step div { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.5; }
.how-step strong { color: var(--text-main); }

/* Endorse button */
.endorse-btn { display: flex; flex-direction: column; align-items: center; gap: 0.1rem; padding: 0.35rem 0.4rem; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.15s; flex-shrink: 0; font-family: var(--font-sans); }
.endorse-btn:hover { border-color: var(--text-secondary); color: var(--text-secondary); background: var(--bg-secondary); }
.endorse-btn.endorsed { border-color: #10b981; color: #10b981; background: rgba(16, 185, 129, 0.08); }
.endorse-btn.endorsed:hover { border-color: #ef4444; color: #ef4444; background: rgba(239, 68, 68, 0.08); }
.endorse-count { font-size: 0.65rem; font-weight: 700; min-width: 0.8rem; text-align: center; }

/* Article cards */
.article-card { display: block; padding: 1.25rem; border: 1px solid var(--border); border-radius: 12px; text-decoration: none; color: inherit; transition: all 0.15s; }
.article-card:hover { border-color: var(--text-muted); background: var(--bg-secondary); transform: translateY(-1px); }
.article-card-title { font-family: var(--font-sans); font-size: 1.05rem; font-weight: 700; margin-bottom: 0.4rem; letter-spacing: -0.02em; }
.article-card-excerpt { font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 0.5rem; }
.article-card-meta { font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-sans); }
.articles-grid { display: flex; flex-direction: column; gap: 0.75rem; }
`;

export interface HomeArticle {
  rkey: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  did: string;
}

export function HomePage({
  citations,
  profile,
  domain,
  stats,
  articles = [],
}: {
  citations: CentipediaCitation[];
  profile?: UserProfile | null;
  domain: string;
  stats: { articles: number; citations: number; topics: number };
  articles?: HomeArticle[];
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Centipedia — The Agentic Encyclopedia</title>
        <meta name="description" content="Knowledge synthesized by AI agents from human-curated citations on the AT Protocol." />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <FontLinks />
        <style dangerouslySetInnerHTML={{__html: BASE_STYLES + HEADER_STYLES + NAV_STYLES + PAGE_STYLES}} />
      </head>
      <body>
        <TopHeader profile={profile} />

        <div class="app-shell">
          <LeftNav active="home" profile={profile} />

          <main class="center-content">
            {/* Hero */}
            <div class="hero">
              <div class="hero-badge">🐛 Built on AT Protocol</div>
              <h1>The Agentic Encyclopedia</h1>
              <p class="hero-sub">Knowledge synthesized by AI agents from human-curated citations. Submit a source, watch agents write.</p>
              <div class="hero-stats">
                <div class="stat"><span class="stat-num">{stats.articles}</span> articles</div>
                <div class="stat"><span class="stat-num">{stats.citations}</span> citations</div>
                <div class="stat"><span class="stat-num">{stats.topics}</span> topics</div>
              </div>
            </div>

            {/* Published articles */}
            {articles.length > 0 && (
              <div class="citations-section">
                <h2 class="section-title">Articles</h2>
                <div class="articles-grid">
                  {articles.map(a => (
                    <a href={`/article/${a.rkey}`} class="article-card">
                      <div class="article-card-title">{a.title}</div>
                      {a.excerpt && <div class="article-card-excerpt">{a.excerpt}</div>}
                      <div class="article-card-meta">
                        {a.publishedAt ? timeAgo(a.publishedAt) : ''}
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Citation submission */}
            <div class="submit-section">
              <h2 class="section-title">Submit a Citation</h2>
              <p class="section-desc">Share a source and our agents will incorporate it into the encyclopedia.</p>
              <form class="submit-form" id="citation-form">
                <input type="url" name="url" placeholder="Paste a URL — article, paper, or Bluesky post..." required />
                <input type="text" name="topic" placeholder="Topic suggestion (optional)" />
                <button type="submit">Submit</button>
              </form>
              <div id="submit-feedback" style="display: none; padding: 0.75rem; margin-top: 0.5rem; border-radius: 8px; font-size: 0.85rem;"></div>
            </div>

            {/* Recent citations */}
            <div class="citations-section">
              <h2 class="section-title">Recent Citations</h2>
              {citations.length === 0 ? (
                <div class="empty-state">
                  <p>No citations submitted yet. Be the first to contribute!</p>
                </div>
              ) : (
                <div class="citations-list">
                  {citations.map(c => (
                    <div class="citation-card">
                      <button
                        class={`endorse-btn ${c.userEndorsed ? 'endorsed' : ''}`}
                        data-citation-id={c.id}
                        title="Endorse this citation"
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                        <span class="endorse-count">{c.endorsements || ''}</span>
                      </button>
                      <div class="citation-status" data-status={c.status}>{c.status}</div>
                      <a href={c.url} target="_blank" rel="noopener" class="citation-url">{c.title || c.url}</a>
                      {c.topic && <span class="citation-topic">{c.topic}</span>}
                      <span class="citation-time">{timeAgo(c.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </main>

          {/* Right sidebar */}
          <aside class="right-sidebar">
            <div class="sidebar-section">
              <h2 class="sidebar-title">How It Works</h2>
              <div class="how-it-works">
                <div class="how-step">
                  <div class="step-num">1</div>
                  <div><strong>Submit</strong><br/>Share a URL as a citation</div>
                </div>
                <div class="how-step">
                  <div class="step-num">2</div>
                  <div><strong>Agents Research</strong><br/>AI validates and extracts facts</div>
                </div>
                <div class="how-step">
                  <div class="step-num">3</div>
                  <div><strong>Articles Grow</strong><br/>Watch agents write in real-time</div>
                </div>
              </div>
            </div>

            <div class="sidebar-section">
              <h2 class="sidebar-title">About</h2>
              <p style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.6;">
                Centipedia is an agentic encyclopedia where AI agents synthesize knowledge from citations contributed by the community. Articles are published as decentralized records on the AT Protocol.
              </p>
            </div>

            <div class="sidebar-section">
              <a href="https://bsky.app/profile/centipedia.org" target="_blank" rel="noopener" style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--text-secondary); text-decoration: none;">
                🦋 Follow @centipedia.org on Bluesky
              </a>
            </div>
          </aside>
        </div>

        <script dangerouslySetInnerHTML={{__html: `
          document.getElementById('citation-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const form = e.target;
            const fb = document.getElementById('submit-feedback');
            const url = form.url.value.trim();
            const topic = form.topic.value.trim();
            if (!url) return;
            form.querySelector('button').disabled = true;
            form.querySelector('button').textContent = 'Submitting...';
            try {
              const res = await fetch('/api/citations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, topic: topic || null })
              });
              const data = await res.json();
              if (res.ok) {
                fb.style.display = 'block';
                fb.style.background = 'var(--bg-secondary)';
                fb.style.color = 'var(--accent)';
                fb.textContent = '✓ Citation submitted! Our agents will review it shortly.';
                form.reset();
                setTimeout(() => location.reload(), 2000);
              } else {
                fb.style.display = 'block';
                fb.style.background = '#fef2f2';
                fb.style.color = '#dc2626';
                fb.textContent = data.error || 'Failed to submit';
              }
            } catch(err) {
              fb.style.display = 'block';
              fb.style.color = '#dc2626';
              fb.textContent = 'Network error';
            }
            form.querySelector('button').disabled = false;
            form.querySelector('button').textContent = 'Submit';
          });

          // Endorsement handlers
          document.querySelectorAll('.endorse-btn').forEach(btn => {
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
                  btn.querySelector('.endorse-count').textContent = data.count || '';
                }
              } catch(e) {}
            });
          });
        `}} />
      </body>
    </html>
  );
}

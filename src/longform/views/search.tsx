/** @jsxImportSource hono/jsx */
import { Layout } from './layout.js';
import { TopHeader, TopHeaderStyles } from './partials.js';
import { sanitizeInlineHtml } from '../../lib/sanitize.js';

export interface SearchResult {
  uri: string;
  did: string;
  title: string;
  site: string | null;
  path: string | null;
  publishedAt: string | null;
  wordCount: number;
  highlight: string | null;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
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

export function SearchPage({
  query,
  results,
  sort,
  profile,
  domain,
}: {
  query: string;
  results: SearchResult[];
  sort: 'relevant' | 'latest';
  profile?: { displayName: string; avatar: string; handle: string } | null;
  domain: string;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{query ? `"${query}" — Search Longform` : 'Search — Longform'}</title>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:ital,wght@0,300;0,400;0,700;1,300;1,400&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{__html: `
          :root {
            --bg: #ffffff;
            --bg-secondary: #f8f9fa;
            --text-main: #1a1a1a;
            --text-secondary: #6b7280;
            --text-muted: #9ca3af;
            --border: #e5e7eb;
            --accent: #111827;
            --accent-hover: #374151;
            --font-body: 'Merriweather', Georgia, serif;
            --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --bg: #0f0f0f;
              --bg-secondary: #1a1a1a;
              --text-main: rgba(255, 255, 255, 0.92);
              --text-secondary: rgba(255, 255, 255, 0.6);
              --text-muted: rgba(255, 255, 255, 0.4);
              --border: rgba(255, 255, 255, 0.08);
              --accent: #ffffff;
              --accent-hover: rgba(255, 255, 255, 0.85);
            }
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          html { overflow-y: scroll; }
          body {
            font-family: var(--font-sans);
            background: var(--bg);
            color: var(--text-main);
            -webkit-font-smoothing: antialiased;
          }
          ${TopHeaderStyles}

          /* Three-column layout */
          .app-shell {
            display: flex;
            min-height: calc(100vh - 49px);
            max-width: 1280px;
            margin: 0 auto;
          }

          /* Left nav */
          .left-nav {
            width: 220px;
            flex-shrink: 0;
            padding: 1.5rem 1.5rem;
            border-right: 1px solid var(--border);
            position: sticky;
            top: 49px;
            height: calc(100vh - 49px);
            display: flex;
            flex-direction: column;
          }
          .nav-items { display: flex; flex-direction: column; gap: 0.25rem; flex: 1; }
          .nav-item {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.65rem 0.85rem;
            border-radius: 10px;
            color: var(--text-secondary);
            text-decoration: none;
            font-size: 0.9rem;
            font-weight: 500;
            transition: all 0.15s;
          }
          .nav-item:hover { background: var(--bg-secondary); color: var(--text-main); }
          .nav-item svg { width: 20px; height: 20px; flex-shrink: 0; }
          .nav-footer { padding-top: 1.5rem; border-top: 1px solid var(--border); }
          .nav-write-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            width: 100%;
            padding: 0.6rem 1rem;
            background: var(--accent);
            color: var(--bg);
            border: none;
            border-radius: 99px;
            font-size: 0.875rem;
            font-weight: 600;
            font-family: var(--font-sans);
            cursor: pointer;
            text-decoration: none;
            transition: background 0.15s;
          }
          .nav-write-btn:hover { background: var(--accent-hover); }

          /* Center column */
          .center-content {
            flex: 1;
            min-width: 0;
            border-right: 1px solid var(--border);
          }
          .center-header {
            position: sticky;
            top: 49px;
            background: var(--bg);
            z-index: 10;
            border-bottom: 1px solid var(--border);
            padding: 1.25rem 1.75rem 0;
          }
          .search-heading {
            font-family: var(--font-body);
            font-size: 1.1rem;
            font-weight: 700;
            color: var(--text-main);
            margin-bottom: 1rem;
          }
          .search-heading span {
            font-weight: 400;
            color: var(--text-secondary);
          }
          .sort-tabs {
            display: flex;
            gap: 0;
          }
          .sort-tab {
            padding: 0.6rem 1.25rem;
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-muted);
            text-decoration: none;
            border-bottom: 2px solid transparent;
            transition: all 0.15s;
          }
          .sort-tab:hover { color: var(--text-secondary); }
          .sort-tab.active {
            color: var(--text-main);
            border-bottom-color: var(--text-main);
          }

          /* Result card */
          .result-card {
            padding: 1.25rem 1.75rem;
            border-bottom: 1px solid var(--border);
            transition: background 0.15s;
          }
          .result-card:hover { background: var(--bg-secondary); }
          .result-link {
            text-decoration: none;
            color: inherit;
            display: block;
          }
          .result-title {
            font-family: var(--font-body);
            font-size: 1.1rem;
            font-weight: 700;
            line-height: 1.4;
            margin-bottom: 0.35rem;
          }
          .result-highlight {
            font-family: var(--font-body);
            font-size: 0.85rem;
            font-weight: 300;
            line-height: 1.6;
            color: var(--text-secondary);
            margin-bottom: 0.5rem;
          }
          .result-highlight em {
            font-style: normal;
            font-weight: 600;
            color: var(--text-main);
            background: rgba(99, 102, 241, 0.1);
            padding: 0.05rem 0.2rem;
            border-radius: 3px;
          }
          .result-meta {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.8rem;
            color: var(--text-muted);
          }
          .result-author {
            display: flex;
            align-items: center;
            gap: 0.35rem;
            text-decoration: none;
            color: var(--text-secondary);
            font-weight: 500;
          }
          .result-author:hover { color: var(--text-main); }
          .result-author img {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            object-fit: cover;
          }
          .result-author-placeholder {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: var(--text-muted);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--bg);
            font-size: 0.55rem;
            font-weight: 700;
          }

          .empty-results {
            text-align: center;
            padding: 4rem 2rem;
            color: var(--text-muted);
          }
          .empty-results h3 {
            font-family: var(--font-body);
            font-size: 1.1rem;
            color: var(--text-secondary);
            margin-bottom: 0.5rem;
          }

          /* Right sidebar */
          .right-sidebar {
            width: 280px;
            flex-shrink: 0;
            padding: 1.5rem;
            position: sticky;
            top: 49px;
            height: calc(100vh - 49px);
            overflow-y: auto;
          }
          .sidebar-section { margin-bottom: 2rem; }
          .sidebar-title {
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--text-muted);
            margin-bottom: 0.75rem;
          }

          @media (max-width: 1024px) { .right-sidebar { display: none; } }
          @media (max-width: 768px) {
            .left-nav { display: none; }
            .center-content { border-right: none; }
            .top-header-search { display: none; }
          }
          @media (prefers-color-scheme: dark) {
            .top-header-dropdown { box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
          }
        `}} />
      </head>
      <body>
        <TopHeader profile={profile} />

        <div class="app-shell">
          {/* Left Navigation */}
          <nav class="left-nav">
            <div class="nav-items">
              <a href="/" class="nav-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                Home
              </a>
              <a href="/posts" class="nav-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <line x1="10" y1="9" x2="8" y2="9" />
                </svg>
                Stories
              </a>
              {profile && (
                <a href={`/profile/${profile.handle}`} class="nav-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Profile
                </a>
              )}
            </div>
            <div class="nav-footer">
              {profile ? (
                <a href="/new" class="nav-write-btn">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Write
                </a>
              ) : (
                <a href="/login" class="nav-write-btn">Sign In</a>
              )}
            </div>
          </nav>

          {/* Center Column */}
          <main class="center-content">
            <div class="center-header" style={query ? "display: flex; align-items: center; justify-content: space-between; padding-right: 1rem;" : ""}>
              <div>
                {query ? (
                  <h1 class="search-heading">Results for <span>"{query}"</span></h1>
                ) : (
                  <h1 class="search-heading">Search</h1>
                )}
                {query && (
                  <div class="sort-tabs">
                    <a href={`/search?q=${encodeURIComponent(query)}&sort=relevant`} class={`sort-tab ${sort === 'relevant' ? 'active' : ''}`}>Relevant</a>
                    <a href={`/search?q=${encodeURIComponent(query)}&sort=latest`} class={`sort-tab ${sort === 'latest' ? 'active' : ''}`}>Latest</a>
                  </div>
                )}
              </div>
              {query && (
                <a href={`/feed/search.xml?q=${encodeURIComponent(query)}`} title="RSS feed for this search" style="display: flex; align-items: center; color: var(--text-muted); transition: color 0.15s; flex-shrink: 0;" onmouseover="this.style.color='#f26522'" onmouseout="this.style.color='var(--text-muted)'">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19 7.38 20 6.18 20C5 20 4 19 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z"/></svg>
                </a>
              )}
            </div>

            <div>
              {!query ? (
                <div class="empty-results">
                  <h3>Search longform articles</h3>
                  <p>Use the search bar above to find articles.</p>
                </div>
              ) : results.length === 0 ? (
                <div class="empty-results">
                  <h3>No results found</h3>
                  <p>Try a different search term.</p>
                </div>
              ) : (
                results.map((r) => {
                  const rkey = r.uri.split('/').pop();
                  const collection = r.uri.split('/')[3];
                  const readUrl = `https://${domain}/post/${r.did}/${rkey}`;
                  const minRead = Math.max(1, Math.ceil(r.wordCount / 200));
                  const ago = timeAgo(r.publishedAt);

                  return (
                    <div class="result-card">
                      <a href={readUrl} class="result-link">
                        <h3 class="result-title">{r.title || 'Untitled'}</h3>
                        {r.highlight && (
                          <div class="result-highlight" dangerouslySetInnerHTML={{__html: sanitizeInlineHtml(r.highlight)}} />
                        )}
                      </a>
                      <div class="result-meta">
                        <a href={`/profile/${r.authorHandle}`} class="result-author">
                          {r.authorAvatar ? (
                            <img src={r.authorAvatar} alt="" />
                          ) : (
                            <div class="result-author-placeholder">{(r.authorName || r.authorHandle).charAt(0).toUpperCase()}</div>
                          )}
                          {r.authorName || r.authorHandle}
                        </a>
                        <span>·</span>
                        {ago && <span>{ago}</span>}
                        {ago && <span>·</span>}
                        <span>{minRead} min read</span>
                        <div style="display: flex; gap: 0.5rem; margin-left: 0.5rem; color: var(--text-muted);">
                          <button onclick={`handleListAction(this, 'like', '${r.did}', '${rkey}', '${(r.title || '').replace(/'/g, "\\'")}')`} style="background: none; border: none; cursor: pointer; color: inherit; padding: 0; display: flex; align-items: center; transition: color 0.15s;" onmouseover="if(!this.dataset.active) this.style.color='#f02050'" onmouseout="if(!this.dataset.active) this.style.color='inherit'" title="Like">
                            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" class="icon"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                          </button>
                          <button onclick={`handleListAction(this, 'repost', '${r.did}', '${rkey}', '${(r.title || '').replace(/'/g, "\\'")}')`} style="background: none; border: none; cursor: pointer; color: inherit; padding: 0; display: flex; align-items: center; transition: color 0.15s;" onmouseover="if(!this.dataset.active) this.style.color='#20d070'" onmouseout="if(!this.dataset.active) this.style.color='inherit'" title="Share on Bluesky">
                            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </main>

          {/* Right Sidebar */}
          <aside class="right-sidebar">
            <div class="sidebar-section" style="margin-top: 1rem;">
              <p style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.6;">
                Longform indexes long-form writing published on the AT Protocol.{' '}
                <a href="/new" style="color: var(--text-secondary);">Start writing →</a>
              </p>
            </div>
          </aside>
        </div>
        <script dangerouslySetInnerHTML={{__html: `
          window.handleListAction = async function(btn, action, authorDid, rkey, title) {
            try {
              const res = await fetch(\`/api/\${action}\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rkey, authorDid, title })
              });
              const data = await res.json();
              if (res.status === 401) {
                alert('Please sign in to interact.');
              } else if (data.success || res.status === 200) {
                btn.dataset.active = "true";
                btn.style.color = action === 'like' ? '#f02050' : '#20d070';
                const icon = btn.querySelector('.icon');
                if (icon && action === 'like') icon.setAttribute('fill', 'currentColor');
              }
            } catch(e) {}
          };
        `}} />
      </body>
    </html>
  );
}

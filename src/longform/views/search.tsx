/** @jsxImportSource hono/jsx */

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

          /* Top header (same as home) */
          .top-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.75rem 2rem;
            border-bottom: 1px solid var(--border);
            font-family: var(--font-sans);
            position: sticky;
            top: 0;
            background: var(--bg);
            z-index: 20;
          }
          .top-header-logo {
            font-family: var(--font-body);
            font-weight: 700;
            font-size: 1.2rem;
            color: var(--text-main);
            text-decoration: none;
            letter-spacing: -0.03em;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          .top-header-logo img { height: 24px; width: auto; }
          .top-header-right {
            display: flex;
            align-items: center;
            gap: 1rem;
          }
          .top-header-signin {
            padding: 0.4rem 1rem;
            background: var(--accent);
            color: var(--bg);
            border-radius: 99px;
            font-size: 0.8rem;
            font-weight: 600;
            text-decoration: none;
          }

          /* Search container */
          .search-layout {
            max-width: 720px;
            margin: 0 auto;
            padding: 2rem 1.5rem;
          }
          .search-form {
            display: flex;
            gap: 0.5rem;
            margin-bottom: 1.5rem;
          }
          .search-input {
            flex: 1;
            padding: 0.65rem 1rem;
            border: 1px solid var(--border);
            border-radius: 8px;
            font-size: 0.95rem;
            font-family: var(--font-sans);
            background: var(--bg);
            color: var(--text-main);
            outline: none;
            transition: border-color 0.15s;
          }
          .search-input:focus {
            border-color: var(--text-secondary);
          }
          .search-btn {
            padding: 0.65rem 1.25rem;
            background: var(--accent);
            color: var(--bg);
            border: none;
            border-radius: 8px;
            font-size: 0.875rem;
            font-weight: 600;
            font-family: var(--font-sans);
            cursor: pointer;
          }

          /* Sort tabs */
          .sort-tabs {
            display: flex;
            gap: 0;
            margin-bottom: 1.5rem;
            border-bottom: 1px solid var(--border);
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
          .sort-tab:hover {
            color: var(--text-secondary);
          }
          .sort-tab.active {
            color: var(--text-main);
            border-bottom-color: var(--text-main);
          }

          /* Result card */
          .result-card {
            padding: 1.25rem 0;
            border-bottom: 1px solid var(--border);
          }
          .result-card:first-child {
            padding-top: 0;
          }
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
          .result-link:hover .result-title {
            color: var(--text-secondary);
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
          .result-count {
            font-size: 0.8rem;
            color: var(--text-muted);
            margin-bottom: 1rem;
          }
        `}} />
      </head>
      <body>
        <header class="top-header">
          <a href="/" class="top-header-logo">
            <img src="/logo.png" alt="Longform" onerror="this.outerHTML='<span>Longform</span>'" />
          </a>
          <div class="top-header-right">
            {profile ? (
              <a href="/posts" style="color: var(--text-secondary); text-decoration: none; font-size: 0.85rem; font-weight: 500;">My Stories</a>
            ) : (
              <a href="/login" class="top-header-signin">Sign In</a>
            )}
          </div>
        </header>

        <div class="search-layout">
          <form class="search-form" action="/search" method="get">
            <input
              type="text"
              name="q"
              class="search-input"
              placeholder="Search longform articles..."
              value={query}
              autofocus
            />
            {sort !== 'relevant' && <input type="hidden" name="sort" value={sort} />}
            <button type="submit" class="search-btn">Search</button>
          </form>

          {query && (
            <div>
              <div class="sort-tabs">
                <a href={`/search?q=${encodeURIComponent(query)}&sort=relevant`} class={`sort-tab ${sort === 'relevant' ? 'active' : ''}`}>Relevant</a>
                <a href={`/search?q=${encodeURIComponent(query)}&sort=latest`} class={`sort-tab ${sort === 'latest' ? 'active' : ''}`}>Latest</a>
              </div>

              {results.length > 0 && (
                <div class="result-count">{results.length} results</div>
              )}

              {results.length === 0 ? (
                <div class="empty-results">
                  <h3>No results found</h3>
                  <p>Try a different search term.</p>
                </div>
              ) : (
                results.map((r) => {
                  const rkey = r.uri.split('/').pop();
                  const collection = r.uri.split('/')[3];
                  let readUrl: string;
                  if (r.site && r.path && r.site.startsWith('http')) {
                    readUrl = `${r.site}${r.path}`;
                  } else if (collection === 'com.whtwnd.blog.entry') {
                    readUrl = `https://whtwnd.com/${r.authorHandle}/${rkey}`;
                  } else {
                    readUrl = `https://${domain}/post/${r.did}/${rkey}`;
                  }
                  const minRead = Math.max(1, Math.ceil(r.wordCount / 200));
                  const ago = timeAgo(r.publishedAt);

                  return (
                    <div class="result-card">
                      <a href={readUrl} class="result-link" target="_blank" rel="noopener noreferrer">
                        <h3 class="result-title">{r.title || 'Untitled'}</h3>
                        {r.highlight && (
                          <div class="result-highlight" dangerouslySetInnerHTML={{__html: r.highlight}} />
                        )}
                      </a>
                      <div class="result-meta">
                        <a href={`/@${r.authorHandle}`} class="result-author">
                          {r.authorAvatar && <img src={r.authorAvatar} alt="" />}
                          {r.authorName || r.authorHandle}
                        </a>
                        <span>·</span>
                        {ago && <span>{ago}</span>}
                        {ago && <span>·</span>}
                        <span>{minRead} min read</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </body>
    </html>
  );
}

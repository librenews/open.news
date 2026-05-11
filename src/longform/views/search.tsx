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

          /* Top header — same as home */
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
          .top-header-search {
            display: flex;
            align-items: center;
            flex: 1;
            max-width: 320px;
            margin: 0 0 0 1rem;
            position: relative;
          }
          .top-header-search .search-icon {
            position: absolute;
            left: 0.6rem;
            top: 50%;
            transform: translateY(-50%);
            width: 14px;
            height: 14px;
            color: var(--text-muted);
            pointer-events: none;
          }
          .top-header-search input {
            width: 100%;
            padding: 0.45rem 0.75rem 0.45rem 2rem;
            border: 1px solid var(--border);
            border-radius: 20px;
            font-size: 0.8rem;
            font-family: var(--font-sans);
            background: var(--bg-secondary);
            color: var(--text-main);
            outline: none;
            transition: border-color 0.15s, background 0.15s;
          }
          .top-header-search input:focus {
            border-color: var(--text-muted);
            background: var(--bg);
          }
          .top-header-search input::placeholder { color: var(--text-muted); }
          .top-header-links {
            display: flex;
            gap: 1.25rem;
            align-items: center;
          }
          .top-header-links a {
            color: var(--text-secondary);
            text-decoration: none;
            font-size: 0.85rem;
            font-weight: 500;
            transition: color 0.15s;
          }
          .top-header-links a:hover { color: var(--text-main); }
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
          .top-header-user {
            position: relative;
            cursor: pointer;
          }
          .top-header-user img {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            object-fit: cover;
            display: block;
          }
          .top-header-user-placeholder {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            background: var(--text-muted);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--bg);
            font-size: 0.75rem;
            font-weight: 700;
          }
          .top-header-dropdown {
            display: none;
            position: absolute;
            top: 100%;
            right: 0;
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 10px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.12);
            min-width: 180px;
            z-index: 50;
          }
          .top-header-dropdown::before {
            content: '';
            position: absolute;
            top: -8px;
            left: 0;
            right: 0;
            height: 8px;
          }
          .top-header-user:hover .top-header-dropdown { display: block; }
          .top-header-dropdown a {
            display: block;
            padding: 0.6rem 1rem;
            font-size: 0.85rem;
            color: var(--text-secondary) !important;
            text-decoration: none;
            font-weight: 500;
          }
          .top-header-dropdown a:hover { background: var(--bg-secondary); }
          .top-header-dropdown .signout-link {
            color: #d32f2f !important;
            border-top: 1px solid var(--border);
          }

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
        {/* Top navigation header — same as home */}
        <header class="top-header">
          <a href="/" class="top-header-logo">
            <img src="/logo.png" alt="Longform" onerror="this.outerHTML='<span>Longform</span>'" />
          </a>
          <form class="top-header-search" action="/search" method="get">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input type="text" name="q" placeholder="Search articles..." value={query} />
          </form>
          <div class="top-header-links">
            <a href="/">Home</a>
            <a href="/posts">Stories</a>
            {profile && <a href={`/profile/${profile.handle}`}>Profile</a>}
          </div>
          <div class="top-header-right">
            {profile ? (
              <div class="top-header-user">
                {profile.avatar ? (
                  <img src={profile.avatar} alt="" />
                ) : (
                  <div class="top-header-user-placeholder">
                    {profile.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div class="top-header-dropdown">
                  <div style="padding: 0.6rem 1rem; border-bottom: 1px solid var(--border);">
                    <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-main);">{profile.displayName}</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted);">@{profile.handle}</div>
                  </div>
                  <a href={`/profile/${profile.handle}`}>Profile</a>
                  <a href="/posts">My Stories</a>
                  <a href="/new">New Draft</a>
                  <a href="/logout" class="signout-link">Sign out</a>
                </div>
              </div>
            ) : (
              <a href="/login" class="top-header-signin">Sign In</a>
            )}
          </div>
        </header>

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
            <div class="center-header">
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
                  let readUrl: string;
                  if (r.site && r.path && r.site.startsWith('http')) {
                    readUrl = `${r.site}${r.path}`;
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
      </body>
    </html>
  );
}

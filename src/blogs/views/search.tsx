import { html, raw } from 'hono/html';
import type { BlogsProfile } from './layout.js';

export interface BlogSearchResult {
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
  verified: boolean;
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sanitizeHighlight(s: string): string {
  return s.replace(/<(?!\/?em\b)[^>]*>/g, '');
}

export function BlogSearchPage({ query, results, sort, filter, page, perPage, total, session }: {
  query: string;
  results: BlogSearchResult[];
  sort: 'relevant' | 'latest';
  filter: 'verified' | 'all';
  page: number;
  perPage: number;
  total: number;
  session?: BlogsProfile | null;
}) {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const totalPages = Math.ceil(total / perPage);

  function buildUrl(overrides: { sort?: string; filter?: string; page?: number }) {
    const s = overrides.sort || sort;
    const f = overrides.filter || filter;
    const p = overrides.page || 1;
    return `/search?q=${encodeURIComponent(query)}&sort=${s}&filter=${f}${p > 1 ? `&page=${p}` : ''}`;
  }

  return html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${query ? `"${escapeHtml(query)}" — Search blogs.social` : 'Search — blogs.social'}</title>
        <meta name="description" content="${query ? `Search results for "${escapeHtml(query)}" on blogs.social` : 'Search all blog posts on blogs.social'}" />
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          :root {
            --bg: #0a0a0c;
            --bg-card: #131318;
            --bg-hover: #1a1a22;
            --bg-surface: #0f0f14;
            --border: rgba(255,255,255,0.06);
            --border-hover: rgba(255,255,255,0.12);
            --text: rgba(255,255,255,0.93);
            --text-secondary: rgba(255,255,255,0.65);
            --text-muted: rgba(255,255,255,0.4);
            --accent: #6366f1;
            --accent-hover: #818cf8;
            --accent-dim: rgba(99,102,241,0.12);
            --green: #10b981;
            --green-dim: rgba(16,185,129,0.12);
            --red: #ef4444;
            --verified-color: #22d3ee;
            --font: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            --radius: 12px;
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          html { overflow-y: scroll; }
          body { background: var(--bg); color: var(--text); font-family: var(--font); -webkit-font-smoothing: antialiased; line-height: 1.55; }
          a { color: var(--accent); text-decoration: none; }
          a:hover { color: var(--accent-hover); }

          .bl-header { position: sticky; top: 0; z-index: 100; background: rgba(10,10,12,0.8); backdrop-filter: blur(16px) saturate(1.5); border-bottom: 1px solid var(--border); }
          .bl-header-inner { max-width: 1240px; margin: 0 auto; padding: 0 0.75rem; height: 52px; display: flex; align-items: center; gap: 1rem; }
          .bl-logo { flex-shrink: 0; font-size: 1.15rem; font-weight: 700; color: var(--text); text-decoration: none; letter-spacing: -0.04em; padding-left: 0.75rem; }
          .bl-logo span { color: var(--accent); }
          .bl-header-search { flex: 1; max-width: 480px; position: relative; }
          .bl-header-search input { width: 100%; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 0.45rem 0.75rem 0.45rem 2.25rem; font-size: 0.85rem; color: var(--text); font-family: var(--font); outline: none; transition: border-color 0.15s; }
          .bl-header-search input:focus { border-color: var(--accent); }
          .bl-header-search input::placeholder { color: var(--text-muted); }
          .bl-header-search svg { position: absolute; left: 0.65rem; top: 50%; transform: translateY(-50%); width: 15px; height: 15px; color: var(--text-muted); pointer-events: none; }
          .bl-header-actions { display: flex; align-items: center; gap: 0.75rem; flex-shrink: 0; }
          .bl-btn { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.78rem; font-weight: 600; padding: 0.4rem 0.85rem; border-radius: 99px; border: none; cursor: pointer; transition: all 0.15s; text-decoration: none; font-family: var(--font); }
          .bl-btn-primary { background: var(--accent); color: white; }
          .bl-btn-primary:hover { background: var(--accent-hover); color: white; }

          .bl-user-menu { position: relative; cursor: pointer; }
          .bl-user-menu img { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; display: block; }
          .bl-user-placeholder { width: 30px; height: 30px; border-radius: 50%; background: var(--accent-dim); display: flex; align-items: center; justify-content: center; color: var(--accent); font-size: 0.75rem; font-weight: 700; }
          .bl-user-dropdown { display: none; position: absolute; top: 100%; right: 0; background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.45); min-width: 190px; z-index: 50; }
          .bl-user-dropdown::before { content: ''; position: absolute; top: -8px; left: 0; right: 0; height: 8px; }
          .bl-user-menu:hover .bl-user-dropdown { display: block; }
          .bl-user-dropdown-header { padding: 0.65rem 1rem; border-bottom: 1px solid var(--border); }
          .bl-user-dropdown-name { font-weight: 600; font-size: 0.85rem; color: var(--text); }
          .bl-user-dropdown-handle { font-size: 0.72rem; color: var(--text-muted); }
          .bl-user-dropdown a { display: block; padding: 0.55rem 1rem; font-size: 0.82rem; color: var(--text-secondary); text-decoration: none; font-weight: 500; transition: background 0.1s; }
          .bl-user-dropdown a:hover { background: var(--bg-hover); color: var(--text); }
          .bl-user-dropdown .bl-signout-link { color: var(--red); border-top: 1px solid var(--border); }

          .search-container { max-width: 760px; margin: 0 auto; padding: 0 1rem; }
          .search-header { padding: 1.5rem 0 0; }
          .search-heading { font-size: 1.1rem; font-weight: 700; color: var(--text); margin-bottom: 0.25rem; }
          .search-heading span { font-weight: 400; color: var(--text-secondary); }
          .search-meta { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem; }
          .search-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); }
          .search-tab { padding: 0.6rem 1.25rem; font-size: 0.85rem; font-weight: 600; color: var(--text-muted); text-decoration: none; border-bottom: 2px solid transparent; transition: all 0.15s; margin-bottom: -1px; }
          .search-tab:hover { color: var(--text-secondary); }
          .search-tab.active { color: var(--text); border-bottom-color: var(--accent); }
          .search-sort { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 0; }
          .search-sort-label { font-size: 0.75rem; color: var(--text-muted); font-weight: 500; }
          .sort-pill { font-size: 0.75rem; font-weight: 600; padding: 0.3rem 0.7rem; border-radius: 99px; color: var(--text-muted); text-decoration: none; background: transparent; border: 1px solid transparent; transition: all 0.15s; }
          .sort-pill:hover { color: var(--text-secondary); border-color: var(--border); }
          .sort-pill.active { color: var(--text); background: var(--accent-dim); border-color: var(--accent); }

          .result-card { padding: 1rem 0; border-bottom: 1px solid var(--border); }
          .result-link { text-decoration: none; color: inherit; display: block; }
          .result-title { font-size: 0.95rem; font-weight: 700; line-height: 1.4; margin-bottom: 0.3rem; color: var(--text); }
          .result-title:hover { color: var(--accent-hover); }
          .result-highlight { font-size: 0.82rem; font-weight: 400; line-height: 1.6; color: var(--text-secondary); margin-bottom: 0.4rem; }
          .result-highlight em { font-style: normal; font-weight: 600; color: var(--text); background: var(--accent-dim); padding: 0.05rem 0.2rem; border-radius: 3px; }
          .result-meta { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; color: var(--text-muted); flex-wrap: wrap; }
          .result-author { display: flex; align-items: center; gap: 0.3rem; text-decoration: none; color: var(--text-secondary); font-weight: 500; }
          .result-author:hover { color: var(--text); }
          .result-author img { width: 18px; height: 18px; border-radius: 50%; object-fit: cover; }
          .result-author-placeholder { width: 18px; height: 18px; border-radius: 50%; background: var(--text-muted); display: flex; align-items: center; justify-content: center; color: var(--bg); font-size: 0.5rem; font-weight: 700; }
          .result-verified-badge { font-size: 0.65rem; font-weight: 700; color: var(--verified-color); background: rgba(34,211,238,0.08); padding: 0.15rem 0.4rem; border-radius: 99px; letter-spacing: 0.02em; }
          .result-site { color: var(--text-muted); font-size: 0.72rem; }

          .empty-results { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
          .empty-results h3 { font-size: 1rem; color: var(--text-secondary); margin-bottom: 0.5rem; }

          .search-hero { text-align: center; padding: 6rem 2rem 4rem; }
          .search-hero h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.75rem; color: var(--text); }
          .search-hero p { color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 1.5rem; }
          .search-hero-form { max-width: 520px; margin: 0 auto; position: relative; }
          .search-hero-form input { width: 100%; background: var(--bg-card); border: 1px solid var(--border-hover); border-radius: 12px; padding: 0.85rem 1rem 0.85rem 2.75rem; font-size: 1rem; color: var(--text); font-family: var(--font); outline: none; transition: border-color 0.15s; }
          .search-hero-form input:focus { border-color: var(--accent); }
          .search-hero-form input::placeholder { color: var(--text-muted); }
          .search-hero-form svg { position: absolute; left: 0.9rem; top: 50%; transform: translateY(-50%); width: 18px; height: 18px; color: var(--text-muted); pointer-events: none; }

          .search-pagination { display: flex; align-items: center; justify-content: center; gap: 1rem; padding: 1.5rem 0 2rem; }
          .search-pagination a { font-size: 0.82rem; font-weight: 600; color: var(--accent); text-decoration: none; padding: 0.4rem 1rem; border: 1px solid var(--border); border-radius: 8px; transition: all 0.15s; }
          .search-pagination a:hover { border-color: var(--accent); background: var(--accent-dim); }
          .search-pagination .page-info { font-size: 0.78rem; color: var(--text-muted); }

          @media (max-width: 640px) {
            .bl-header-search { display: none; }
            .search-hero { padding: 3rem 1rem 2rem; }
            .search-hero h1 { font-size: 1.2rem; }
          }
        </style>
      </head>
      <body>
        <header class="bl-header">
          <div class="bl-header-inner">
            <a href="/" class="bl-logo">blogs<span>.social</span></a>
            <form action="/search" method="GET" class="bl-header-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" name="q" placeholder="Search posts…" value="${escapeHtml(query)}" autocomplete="off" />
            </form>
            <div class="bl-header-actions">
              ${session
                ? html`
              <div class="bl-user-menu">
                ${session.avatar
                  ? html`<img src="${session.avatar}" alt="" />`
                  : html`<div class="bl-user-placeholder">${(session.displayName || session.handle || '?')[0].toUpperCase()}</div>`
                }
                <div class="bl-user-dropdown">
                  <div class="bl-user-dropdown-header">
                    <div class="bl-user-dropdown-name">${session.displayName || session.handle}</div>
                    <div class="bl-user-dropdown-handle">@${session.handle}</div>
                  </div>
                  <a href="/author/${session.did}">Profile</a>
                  <a href="/subscriptions">Subscriptions</a>
                  <a href="/stats">Stats</a>
                  <a href="/auth/logout" class="bl-signout-link">Sign out</a>
                </div>
              </div>
              `
                : html`<a href="/auth/login" class="bl-btn bl-btn-primary">Sign in</a>`
              }
            </div>
          </div>
        </header>

        <div class="search-container">
          ${!query ? html`
            <div class="search-hero">
              <h1>Search blogs.social</h1>
              <p>Find posts across the open social web</p>
              <form action="/search" method="GET" class="search-hero-form">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input type="text" name="q" placeholder="Search posts, articles, blogs…" autofocus autocomplete="off" />
              </form>
            </div>
          ` : html`
            <div class="search-header">
              <h1 class="search-heading">Results for <span>"${escapeHtml(query)}"</span></h1>
              <div class="search-meta">${fmt(total)} result${total !== 1 ? 's' : ''}${totalPages > 1 ? ` · page ${page} of ${fmt(totalPages)}` : ''}</div>
              <div class="search-tabs">
                <a href="${buildUrl({ filter: 'all' })}" class="search-tab ${filter === 'all' ? 'active' : ''}">All</a>
                <a href="${buildUrl({ filter: 'verified' })}" class="search-tab ${filter === 'verified' ? 'active' : ''}">✅ Verified</a>
              </div>
              <div class="search-sort">
                <span class="search-sort-label">Sort:</span>
                <a href="${buildUrl({ sort: 'relevant' })}" class="sort-pill ${sort === 'relevant' ? 'active' : ''}">Relevant</a>
                <a href="${buildUrl({ sort: 'latest' })}" class="sort-pill ${sort === 'latest' ? 'active' : ''}">Latest</a>
              </div>
            </div>

            <div>
              ${results.length === 0
                ? html`
                  <div class="empty-results">
                    <h3>No results found</h3>
                    <p>Try a different search term${filter === 'verified' ? ' or switch to "All" results.' : '.'}</p>
                  </div>
                `
                : results.map(r => {
                    const rkey = r.uri.split('/').pop();
                    const readUrl = `/post/${r.did}/${rkey}`;
                    const minRead = Math.max(1, Math.ceil(r.wordCount / 200));
                    const ago = timeAgo(r.publishedAt);
                    const siteName = r.site ? r.site.replace(/^https?:\/\/(www\.)?/, '') : null;
                    return html`
                      <div class="result-card">
                        <a href="${readUrl}" class="result-link">
                          <h3 class="result-title">${r.title || 'Untitled'}</h3>
                          ${r.highlight ? html`<div class="result-highlight">${raw(sanitizeHighlight(r.highlight))}</div>` : ''}
                        </a>
                        <div class="result-meta">
                          <a href="/author/${r.did}" class="result-author">
                            ${r.authorAvatar
                              ? html`<img src="${r.authorAvatar}" alt="" />`
                              : html`<div class="result-author-placeholder">${(r.authorName || r.authorHandle).charAt(0).toUpperCase()}</div>`
                            }
                            ${r.authorName || r.authorHandle}
                          </a>
                          ${r.verified ? html`<span class="result-verified-badge">Verified</span>` : ''}
                          ${siteName ? html`<span class="result-site">${siteName}</span>` : ''}
                          <span>·</span>
                          ${ago ? html`<span>${ago}</span><span>·</span>` : ''}
                          <span>${minRead} min read</span>
                        </div>
                      </div>
                    `;
                  })
              }
            </div>

            ${totalPages > 1 ? html`
              <div class="search-pagination">
                ${page > 1 ? html`<a href="${buildUrl({ page: page - 1 })}">← Previous</a>` : ''}
                <span class="page-info">Page ${page} of ${fmt(totalPages)}</span>
                ${page < totalPages ? html`<a href="${buildUrl({ page: page + 1 })}">Next →</a>` : ''}
              </div>
            ` : ''}
          `}
        </div>
      </body>
    </html>
  `;
}

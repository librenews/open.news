import { html, raw } from 'hono/html';

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

export const BlogSearchStyles = `
  .search-header { padding: 0.5rem 0 0; }
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
  .result-link:hover .result-title { color: var(--accent-hover); }
  .result-highlight { font-size: 0.82rem; font-weight: 400; line-height: 1.6; color: var(--text-secondary); margin-bottom: 0.4rem; }
  .result-highlight em { font-style: normal; font-weight: 600; color: var(--text); background: var(--accent-dim); padding: 0.05rem 0.2rem; border-radius: 3px; }
  .result-meta { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; color: var(--text-muted); flex-wrap: wrap; }
  .result-author { display: flex; align-items: center; gap: 0.3rem; text-decoration: none; color: var(--text-secondary); font-weight: 500; }
  .result-author:hover { color: var(--text); }
  .result-author img { width: 18px; height: 18px; border-radius: 50%; object-fit: cover; }
  .result-author-placeholder { width: 18px; height: 18px; border-radius: 50%; background: var(--text-muted); display: flex; align-items: center; justify-content: center; color: var(--bg); font-size: 0.5rem; font-weight: 700; }
  .result-verified-badge { font-size: 0.65rem; font-weight: 700; color: #22d3ee; background: rgba(34,211,238,0.08); padding: 0.15rem 0.4rem; border-radius: 99px; letter-spacing: 0.02em; }
  .result-site { color: var(--text-muted); font-size: 0.72rem; }
  .search-empty { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
  .search-empty h3 { font-size: 1rem; color: var(--text-secondary); margin-bottom: 0.5rem; }

  .search-hero { text-align: center; padding: 4rem 1rem 3rem; }
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
`;

export function BlogSearchContent({ query, results, sort, filter, page, perPage, total }: {
  query: string;
  results: BlogSearchResult[];
  sort: 'relevant' | 'latest';
  filter: 'verified' | 'all';
  page: number;
  perPage: number;
  total: number;
}) {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const totalPages = Math.ceil(total / perPage);

  function buildUrl(overrides: { sort?: string; filter?: string; page?: number }) {
    const s = overrides.sort || sort;
    const f = overrides.filter || filter;
    const p = overrides.page || 1;
    return `/search?q=${encodeURIComponent(query)}&sort=${s}&filter=${f}${p > 1 ? `&page=${p}` : ''}`;
  }

  if (!query) {
    return html`
      <div class="search-hero">
        <h1>Search blogs.social</h1>
        <p>Find posts across the open social web</p>
        <form action="/search" method="GET" class="search-hero-form">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" name="q" placeholder="Search posts, articles, blogs…" autofocus autocomplete="off" />
        </form>
      </div>
    `;
  }

  return html`
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
          <div class="search-empty">
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
  `;
}

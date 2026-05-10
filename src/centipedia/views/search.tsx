/** @jsxImportSource hono/jsx */
import { BASE_STYLES, HEADER_STYLES, NAV_STYLES, FontLinks, TopHeader, LeftNav } from './partials.js';
import type { UserProfile } from './partials.js';

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

const PAGE_STYLES = `
.center-content { flex: 1; min-width: 0; border-right: 1px solid var(--border); border-left: 1px solid var(--border); }
.center-header { position: sticky; top: var(--header-height); background: var(--bg); z-index: 10; border-bottom: 1px solid var(--border); padding: 1.25rem 1.75rem 0; }
.search-heading { font-family: var(--font-body); font-size: 1.1rem; font-weight: 700; color: var(--text-main); margin-bottom: 1rem; }
.search-heading span { font-weight: 400; color: var(--text-secondary); }
.sort-tabs { display: flex; gap: 0; }
.sort-tab { padding: 0.6rem 1.25rem; font-size: 0.85rem; font-weight: 600; color: var(--text-muted); text-decoration: none; border-bottom: 2px solid transparent; transition: all 0.15s; }
.sort-tab:hover { color: var(--text-secondary); }
.sort-tab.active { color: var(--text-main); border-bottom-color: var(--text-main); }
.result-card { padding: 1.25rem 1.75rem; border-bottom: 1px solid var(--border); transition: background 0.15s; }
.result-card:hover { background: var(--bg-secondary); }
.result-link { text-decoration: none; color: inherit; display: block; }
.result-title { font-family: var(--font-body); font-size: 1.1rem; font-weight: 700; line-height: 1.4; margin-bottom: 0.35rem; }
.result-highlight { font-family: var(--font-body); font-size: 0.85rem; font-weight: 300; line-height: 1.6; color: var(--text-secondary); margin-bottom: 0.5rem; }
.result-highlight em { font-style: normal; font-weight: 600; color: var(--text-main); background: rgba(99, 102, 241, 0.1); padding: 0.05rem 0.2rem; border-radius: 3px; }
.result-meta { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; color: var(--text-muted); }
.result-author { display: flex; align-items: center; gap: 0.35rem; text-decoration: none; color: var(--text-secondary); font-weight: 500; }
.result-author:hover { color: var(--text-main); }
.result-author img { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
.result-author-placeholder { width: 20px; height: 20px; border-radius: 50%; background: var(--text-muted); display: flex; align-items: center; justify-content: center; color: var(--bg); font-size: 0.55rem; font-weight: 700; }
.empty-results { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
.empty-results h3 { font-family: var(--font-body); font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 0.5rem; }
`;

export function SearchPage({
  query, results, sort, profile, domain,
}: {
  query: string;
  results: SearchResult[];
  sort: 'relevant' | 'latest';
  profile?: UserProfile | null;
  domain: string;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{query ? `"${query}" — Search Centipedia` : 'Search — Centipedia'}</title>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <FontLinks />
        <style dangerouslySetInnerHTML={{__html: BASE_STYLES + HEADER_STYLES + NAV_STYLES + PAGE_STYLES}} />
      </head>
      <body>
        <TopHeader profile={profile} />

        <div class="app-shell">
          <LeftNav active="search" profile={profile} />

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
                  <h3>Search articles</h3>
                  <p>Use the search bar above to find articles.</p>
                </div>
              ) : results.length === 0 ? (
                <div class="empty-results">
                  <h3>No results found</h3>
                  <p>Try a different search term.</p>
                </div>
              ) : (
                results.map((r) => {
                  const isCitation = r.authorHandle === 'citation';
                  const isArticle = r.authorHandle === 'centipedia';
                  let readUrl: string;
                  if (isArticle && r.path) {
                    readUrl = r.path;
                  } else if (isCitation && r.path) {
                    readUrl = r.path;
                  } else if (isCitation) {
                    readUrl = r.uri; // external citation URL
                  } else if (r.site && r.path && r.site.startsWith('http')) {
                    readUrl = `${r.site}${r.path}`;
                  } else {
                    const rkey = r.uri.split('/').pop();
                    readUrl = `/article/${rkey}`;
                  }
                  const minRead = r.wordCount > 0 ? Math.max(1, Math.ceil(r.wordCount / 200)) : 0;
                  const ago = timeAgo(r.publishedAt);

                  // Determine meta link
                  const metaHref = isCitation && r.site ? `/topics/${r.site.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}` : isArticle ? null : `/profile/${r.authorHandle}`;
                  const isExternal = isCitation && !r.path;

                  return (
                    <div class="result-card">
                      <a href={readUrl} class="result-link" {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                        <h3 class="result-title">{r.title || 'Untitled'}</h3>
                        {r.highlight && (
                          <div class="result-highlight" dangerouslySetInnerHTML={{__html: r.highlight}} />
                        )}
                      </a>
                      <div class="result-meta">
                        {metaHref ? (
                          <a href={metaHref} class="result-author">
                            {r.authorAvatar ? (
                              <img src={r.authorAvatar} alt="" />
                            ) : (
                              <div class="result-author-placeholder">{(r.authorName || r.authorHandle).charAt(0).toUpperCase()}</div>
                            )}
                            {r.authorName || r.authorHandle}
                          </a>
                        ) : (
                          <span class="result-author" style="cursor: default;">
                            <div class="result-author-placeholder">C</div>
                            Centipedia
                          </span>
                        )}
                        {ago && <><span>·</span><span>{ago}</span></>}
                        {minRead > 0 && <><span>·</span><span>{minRead} min read</span></>}
                        {r.highlight && isCitation && <><span>·</span><span>{r.highlight}</span></>}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </main>

          <aside class="right-sidebar">
            <div class="sidebar-section" style="margin-top: 1rem;">
              <p style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.6;">
                Centipedia indexes knowledge articles published on the AT Protocol.{' '}
                <a href="/submit" style="color: var(--text-secondary);">Submit a citation →</a>
              </p>
            </div>
          </aside>
        </div>
      </body>
    </html>
  );
}

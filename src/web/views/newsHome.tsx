/** @jsxImportSource hono/jsx */
import type { VerifiedArticle, AuthorSummary, TopicCluster } from '../../db/queries/articleRelations.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'Just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function siteName(site: string | null): string {
  if (!site) return '';
  try {
    return new URL(site).hostname.replace(/^www\./, '');
  } catch {
    return site;
  }
}

function articleUrl(article: VerifiedArticle): string {
  if (article.site && article.path) {
    const base = article.site.endsWith('/') ? article.site.slice(0, -1) : article.site;
    const path = article.path.startsWith('/') ? article.path : `/${article.path}`;
    return `${base}${path}`;
  }
  // Fallback to AT URI viewer
  return `https://pdsls.dev/at/${encodeURIComponent(article.uri)}`;
}

function authorInitial(handle: string | null, did: string): string {
  if (handle) return handle.charAt(0).toUpperCase();
  return did.slice(-2).toUpperCase();
}

function displayHandle(handle: string | null): string {
  if (!handle) return 'Unknown';
  if (handle.endsWith('.bsky.social')) return `@${handle.replace('.bsky.social', '')}`;
  return `@${handle}`;
}

// ── Sub-Components ───────────────────────────────────────────────────────────

function InteractionBadges({ article }: { article: VerifiedArticle }) {
  const badges = [];
  if (article.like_count > 0) {
    badges.push(
      <span class="int-badge has-count" title={`${article.like_count} likes`}>
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        {article.like_count}
      </span>
    );
  }
  if (article.repost_count > 0) {
    badges.push(
      <span class="int-badge has-count" title={`${article.repost_count} reposts`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3"/></svg>
        {article.repost_count}
      </span>
    );
  }
  if (badges.length === 0) return null;
  return <span class="int-badges">{badges}</span>;
}

function ArticleMeta({ article }: { article: VerifiedArticle }) {
  const site = siteName(article.site);
  const ago = timeAgo(article.published_at);
  return (
    <div class="art-meta">
      {site && <span class="source">{site}</span>}
      {site && ago && <span class="sep">·</span>}
      {ago && <span>{ago}</span>}
      {article.author_handle && (
        <>
          <span class="sep">·</span>
          <a href={`/author/${encodeURIComponent(article.author_did)}`} class="author-link" onclick="event.stopPropagation()">
            {displayHandle(article.author_handle)}
          </a>
        </>
      )}
      <InteractionBadges article={article} />
    </div>
  );
}

function HeroCard({ article, index }: { article: VerifiedArticle; index: number }) {
  const url = articleUrl(article);
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" class={`hero-card fade-in fade-in-d${index}`}>
      <div class="hero-body">
        <h2 class="hero-title">{article.title || 'Untitled'}</h2>
        {article.description && <p class="hero-desc">{article.description}</p>}
        <ArticleMeta article={article} />
      </div>
    </a>
  );
}

function ArticleRow({ article, index }: { article: VerifiedArticle; index: number }) {
  const url = articleUrl(article);
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" class={`article-row fade-in`} style={`animation-delay:${0.02 * index}s`}>
      <div class="art-body">
        <h3 class="art-title">{article.title || 'Untitled'}</h3>
        {article.description && <p class="art-desc">{article.description}</p>}
        <ArticleMeta article={article} />
      </div>
    </a>
  );
}

function SidebarAuthors({ authors }: { authors: AuthorSummary[] }) {
  if (authors.length === 0) return null;
  return (
    <div class="sidebar-section">
      <h4 class="sidebar-title">Trending Authors</h4>
      {authors.map((a) => (
        <a href={`/author/${encodeURIComponent(a.did)}`} class="sidebar-author">
          <div class="author-avatar">{authorInitial(a.handle, a.did)}</div>
          <div class="author-info">
            <div class="author-name">{displayHandle(a.handle)}</div>
            <div class="author-stats">{a.article_count} articles · {a.total_likes} likes</div>
          </div>
        </a>
      ))}
    </div>
  );
}

function SidebarSites({ sites }: { sites: { site: string; count: number }[] }) {
  if (sites.length === 0) return null;
  return (
    <div class="sidebar-section">
      <h4 class="sidebar-title">Publications</h4>
      {sites.map((s) => (
        <div class="sidebar-site">
          <a href={`/?site=${encodeURIComponent(s.site)}`} class="site-name">{siteName(s.site)}</a>
          <span class="site-count">{s.count}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function NewsHomePage({
  articles,
  stats,
  view,
  topics,
  authors,
  sites,
  isLoggedIn,
}: {
  articles: VerifiedArticle[];
  stats: { totalArticles: number; totalAuthors: number; totalSites: number; articlesToday: number };
  view: 'trending' | 'latest';
  topics: TopicCluster[];
  authors: AuthorSummary[];
  sites: { site: string; count: number }[];
  isLoggedIn?: boolean;
}) {
  const hero = articles[0] ?? null;
  const rest = articles.slice(1);

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>open.news — Verified articles from the open social web</title>
        <meta name="description" content="Discover verified articles and publications from the AT Protocol network. A social news reader powered by community-verified content." />
        <meta property="og:title" content="open.news" />
        <meta property="og:description" content="Verified articles from the open social web" />
        <meta property="og:type" content="website" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/static/css/news.css" />
      </head>
      <body>
        {/* Header */}
        <header class="news-header">
          <div class="news-header-inner">
            <a href="/" class="news-logo">open<span class="dot">.</span>news</a>
            <nav class="news-nav">
              {isLoggedIn ? (
                <>
                  <a href="/chat">Chat</a>
                  <a href="/feed">Feed</a>
                </>
              ) : (
                <a href="/login" class="btn-signin">Sign In</a>
              )}
            </nav>
          </div>
        </header>

        {/* Stats */}
        <div class="stats-strip">
          <div class="stats-strip-inner">
            <span><span class="stat-val">{stats.articlesToday.toLocaleString()}</span> today</span>
            <span><span class="stat-val">{stats.totalArticles.toLocaleString()}</span> articles</span>
            <span><span class="stat-val">{stats.totalAuthors.toLocaleString()}</span> authors</span>
            <span><span class="stat-val">{stats.totalSites.toLocaleString()}</span> publications</span>
          </div>
        </div>

        {/* View tabs */}
        <div class="view-tabs">
          <a href="/?view=trending" class={`view-tab ${view === 'trending' ? 'active' : ''}`}>Trending</a>
          <a href="/?view=latest" class={`view-tab ${view === 'latest' ? 'active' : ''}`}>Latest</a>
        </div>

        {/* Topics */}
        {topics.length > 0 && (
          <div class="topic-bar">
            {topics.map((t) => (
              <a href={`/?topic=${t.id}`} class="topic-pill">
                {t.label}
                <span class="pill-count">{t.article_count}</span>
              </a>
            ))}
          </div>
        )}

        {/* Main content */}
        <div class="news-main">
          <div class="feed-column">
            {articles.length === 0 ? (
              <div class="empty-state">
                <h3>No verified articles yet</h3>
                <p>Articles from verified publications on the AT Protocol will appear here.</p>
              </div>
            ) : (
              <>
                {hero && <HeroCard article={hero} index={0} />}
                <div class="article-grid">
                  {rest.map((a, i) => (
                    <ArticleRow article={a} index={i} />
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Sidebar */}
          <aside class="news-sidebar">
            <SidebarAuthors authors={authors} />
            <SidebarSites sites={sites} />
          </aside>
        </div>

        {/* Footer */}
        <footer class="news-footer">
          <p>Verified articles from the open social web, powered by the AT&nbsp;Protocol.</p>
          <div class="footer-links">
            <a href="/privacy">Privacy</a>
            <a href="/tos">Terms</a>
            <a href="mailto:app@track.social">Contact</a>
          </div>
        </footer>
      </body>
    </html>
  );
}

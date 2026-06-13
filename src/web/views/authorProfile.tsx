/** @jsxImportSource hono/jsx */
import type { AuthorProfile, VerifiedArticle } from '../../db/queries/articleRelations.js';

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
  try { return new URL(site).hostname.replace(/^www\./, ''); } catch { return site; }
}

function articleUrl(a: VerifiedArticle): string {
  if (a.site && a.path) {
    const base = a.site.endsWith('/') ? a.site.slice(0, -1) : a.site;
    const path = a.path.startsWith('/') ? a.path : `/${a.path}`;
    return `${base}${path}`;
  }
  return `https://pdsls.dev/at/${encodeURIComponent(a.uri)}`;
}

function displayHandle(handle: string | null): string {
  if (!handle) return 'Unknown Author';
  if (handle.endsWith('.bsky.social')) return `@${handle.replace('.bsky.social', '')}`;
  return `@${handle}`;
}

function StatCard({ value, label }: { value: number | string; label: string }) {
  return (
    <div class="author-stat-card">
      <div class="stat-number">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div class="stat-label">{label}</div>
    </div>
  );
}

export function AuthorProfilePage({
  profile,
  articles,
  isLoggedIn,
}: {
  profile: AuthorProfile;
  articles: VerifiedArticle[];
  isLoggedIn?: boolean;
}) {
  const memberSince = profile.first_published
    ? new Date(profile.first_published).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
    : null;

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{displayHandle(profile.handle)} — open.news author</title>
        <meta name="description" content={`${displayHandle(profile.handle)} has published ${profile.article_count} verified articles on the AT Protocol.`} />
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

        <div class="news-container" style="padding-top: 2rem; padding-bottom: 2rem;">
          {/* Author hero */}
          <div class="author-hero fade-in">
            <div style="position:relative;z-index:1">
              <h1 class="author-handle">{displayHandle(profile.handle)}</h1>
              <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;">
                {memberSince && (
                  <span style="font-size:0.85rem;color:var(--text-muted)">
                    Publishing since {memberSince}
                  </span>
                )}
                {profile.top_sites.length > 0 && (
                  <span style="font-size:0.85rem;color:var(--text-muted)">
                    · {profile.top_sites.map(s => siteName(s)).join(', ')}
                  </span>
                )}
                <a
                  href={`https://bsky.app/profile/${profile.handle || profile.did}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style="font-size:0.85rem;color:var(--text-link)"
                >
                  View on Bluesky →
                </a>
              </div>

              <div class="author-stats-grid">
                <StatCard value={profile.article_count} label="Articles" />
                <StatCard value={profile.total_likes} label="Likes" />
                <StatCard value={profile.total_reposts} label="Reposts" />
                <StatCard value={profile.total_shares} label="Shares" />
              </div>
            </div>
          </div>

          {/* Articles */}
          <h2 style="font-family:var(--font-display);font-size:1.1rem;font-weight:600;color:var(--text-secondary);margin-bottom:1rem;text-transform:uppercase;letter-spacing:0.06em;">
            Published Articles
          </h2>
          <div class="article-grid">
            {articles.length === 0 ? (
              <div class="empty-state">
                <h3>No verified articles</h3>
                <p>This author hasn't published any verified articles yet.</p>
              </div>
            ) : (
              articles.map((a, i) => {
                const url = articleUrl(a);
                const ago = timeAgo(a.published_at);
                const site = siteName(a.site);
                return (
                  <a href={url} target="_blank" rel="noopener noreferrer" class="article-row fade-in" style={`animation-delay:${0.02 * i}s`}>
                    <div class="art-body">
                      <h3 class="art-title">{a.title || 'Untitled'}</h3>
                      {a.description && <p class="art-desc">{a.description}</p>}
                      <div class="art-meta">
                        {site && <span class="source">{site}</span>}
                        {site && ago && <span class="sep">·</span>}
                        {ago && <span>{ago}</span>}
                        {a.like_count > 0 && (
                          <span class="int-badges">
                            <span class="int-badge has-count">♥ {a.like_count}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </a>
                );
              })
            )}
          </div>
        </div>

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

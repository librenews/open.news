/** @jsxImportSource hono/jsx */
import type { ConvergenceArticle, TopicCluster } from '../../db/queries/convergence.js';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return 'Upcoming';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ArticleCard({ article, featured, userContributed, isLoggedIn }: { article: ConvergenceArticle; featured?: boolean; userContributed?: boolean; isLoggedIn?: boolean }) {
  const ago = timeAgo(article.published_at);
  const source = article.site_name || new URL(article.url).hostname.replace('www.', '');

  if (featured) {
    return (
      <a href={article.url} target="_blank" rel="noopener noreferrer" class="featured-card">
        {article.image_url && (
          <div class="featured-image">
            <img src={article.image_url} alt="" loading="lazy" />
          </div>
        )}
        <div class="featured-content">
          <h2 class="featured-title">{article.title || 'Untitled'}</h2>
          {article.description && <p class="featured-desc">{article.description}</p>}
          <div class="article-meta">
            <span class="source-name">{source}</span>
            {ago && <span class="time-ago">{ago}</span>}
            {article.convergence_score > 0 && (
              <span class="convergence-badge" title={`Surfaced by ${article.track_names.join(', ')}`}>
                {article.convergence_score} {article.convergence_score === 1 ? 'topic' : 'topics'}
              </span>
            )}
            {userContributed && (
              <span class="contributed-badge" title="Your topic monitors helped surface this article">
                ✦ Your topic
              </span>
            )}
          </div>
          <button
            class={`like-btn${article.liked ? ' liked' : ''}`}
            data-article-id={article.id}
            data-logged-in={isLoggedIn ? 'true' : 'false'}
            onclick="handleLike(event, this)"
            title="Like this article"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill={article.liked ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
            </svg>
            <span class="like-count">{article.like_count > 0 ? article.like_count : ''}</span>
          </button>
        </div>
      </a>
    );
  }

  return (
    <a href={article.url} target="_blank" rel="noopener noreferrer" class="article-card">
      {article.image_url && (
        <div class="article-thumb">
          <img src={article.image_url} alt="" loading="lazy" />
        </div>
      )}
      <div class="article-text">
        <h3 class="article-title">{article.title || 'Untitled'}</h3>
        <div class="article-meta">
          <span class="source-name">{source}</span>
          {ago && <span class="time-ago">{ago}</span>}
          {article.convergence_score > 0 && (
            <span class="convergence-badge" title={`Surfaced by ${article.track_names.join(', ')}`}>
              {article.convergence_score} {article.convergence_score === 1 ? 'topic' : 'topics'}
            </span>
          )}
          {userContributed && (
            <span class="contributed-badge" title="Your topic monitors helped surface this article">
              ✦ Your topic
            </span>
          )}
          <button
            class={`like-btn${article.liked ? ' liked' : ''}`}
            data-article-id={article.id}
            data-logged-in={isLoggedIn ? 'true' : 'false'}
            onclick="handleLike(event, this)"
            title="Like this article"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill={article.liked ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2">
              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
            </svg>
            <span class="like-count">{article.like_count > 0 ? article.like_count : ''}</span>
          </button>
        </div>
      </div>
    </a>
  );
}

export function FrontPage({
  articles,
  stats,
  view,
  topics,
  activeTopic,
  userContributedIds,
  isLoggedIn,
}: {
  articles: ConvergenceArticle[];
  stats: { totalTracks: number; articlesToday: number; activeTopics: number };
  view: 'convergence' | 'latest';
  topics: TopicCluster[];
  activeTopic: number | null;
  userContributedIds?: Set<number>;
  isLoggedIn?: boolean;
}) {
  const featured = articles[0];
  const rest = articles.slice(1);

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>open.news — Community-driven news intelligence</title>
        <meta name="description" content="News surfaced by the collective intelligence of community topic trackers on the AT Protocol network." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{__html: `
          :root {
            --bg: #fafaf9;
            --text: #1a1a1a;
            --text-secondary: #6b7280;
            --text-muted: #9ca3af;
            --border: #e5e5e4;
            --accent: #0f766e;
            --accent-light: #f0fdfa;
            --card-hover: #f5f5f4;
            --font-heading: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
            --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          }

          * { box-sizing: border-box; margin: 0; padding: 0; }
          html { overflow-y: scroll; }
          body {
            font-family: var(--font-sans);
            background: var(--bg);
            color: var(--text);
            -webkit-font-smoothing: antialiased;
          }

          /* Header */
          .site-header {
            border-bottom: 1px solid var(--border);
            padding: 1.25rem 0;
          }
          .header-inner {
            max-width: 1080px;
            margin: 0 auto;
            padding: 0 1.5rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .site-logo {
            font-family: var(--font-heading);
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--text);
            text-decoration: none;
            letter-spacing: -0.02em;
          }
          .site-logo span { color: var(--accent); }
          .header-nav {
            display: flex;
            align-items: center;
            gap: 1.5rem;
            font-size: 0.875rem;
          }
          .header-nav a {
            color: var(--text-secondary);
            text-decoration: none;
            font-weight: 500;
            transition: color 0.15s;
          }
          .header-nav a:hover { color: var(--text); }

          /* Stats bar */
          .stats-bar {
            max-width: 1080px;
            margin: 0 auto;
            padding: 0.75rem 1.5rem;
            display: flex;
            gap: 2rem;
            font-size: 0.75rem;
            color: var(--text-muted);
            border-bottom: 1px solid var(--border);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            font-weight: 500;
          }
          .stats-bar strong { color: var(--text-secondary); font-weight: 600; }

          /* View tabs */
          .view-tabs {
            max-width: 1080px;
            margin: 0 auto;
            padding: 1rem 1.5rem 0;
            display: flex;
            gap: 0;
            border-bottom: 1px solid var(--border);
          }
          .view-tab {
            padding: 0.5rem 1.25rem 0.75rem;
            font-size: 0.875rem;
            font-weight: 500;
            color: var(--text-secondary);
            text-decoration: none;
            border-bottom: 2px solid transparent;
            transition: all 0.15s;
          }
          .view-tab:hover { color: var(--text); }
          .view-tab.active {
            color: var(--accent);
            border-bottom-color: var(--accent);
          }

          /* Main content */
          .main-content {
            max-width: 1080px;
            margin: 0 auto;
            padding: 1.5rem;
          }

          /* Featured card */
          .featured-card {
            display: block;
            text-decoration: none;
            color: inherit;
            border-bottom: 1px solid var(--border);
            padding-bottom: 2rem;
            margin-bottom: 1.5rem;
            transition: opacity 0.15s;
          }
          .featured-card:hover { opacity: 0.85; }
          .featured-image {
            width: 100%;
            height: 340px;
            border-radius: 8px;
            overflow: hidden;
            margin-bottom: 1.25rem;
          }
          .featured-image img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
          .featured-title {
            font-family: var(--font-heading);
            font-size: 2rem;
            font-weight: 700;
            line-height: 1.25;
            letter-spacing: -0.02em;
            margin-bottom: 0.5rem;
          }
          .featured-desc {
            color: var(--text-secondary);
            font-size: 1rem;
            line-height: 1.6;
            margin-bottom: 0.75rem;
            max-width: 720px;
          }

          /* Article cards */
          .articles-grid {
            display: flex;
            flex-direction: column;
            gap: 0;
          }
          .article-card {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 1.25rem;
            padding: 1.25rem 0;
            border-bottom: 1px solid var(--border);
            text-decoration: none;
            color: inherit;
            transition: background 0.15s;
          }
          .article-card:hover { background: var(--card-hover); margin: 0 -0.75rem; padding: 1.25rem 0.75rem; border-radius: 8px; border-color: transparent; }
          .article-text { flex: 1; min-width: 0; }
          .article-title {
            font-family: var(--font-heading);
            font-size: 1.125rem;
            font-weight: 600;
            line-height: 1.35;
            letter-spacing: -0.01em;
            margin-bottom: 0.4rem;
          }
          .article-thumb {
            flex-shrink: 0;
            width: 120px;
            height: 80px;
            border-radius: 6px;
            overflow: hidden;
          }
          .article-thumb img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          /* Meta */
          .article-meta {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.8rem;
            color: var(--text-muted);
            flex-wrap: wrap;
          }
          .source-name {
            color: var(--text-secondary);
            font-weight: 500;
          }
          .time-ago::before {
            content: '\\00B7';
            margin-right: 0.5rem;
          }
          .convergence-badge {
            background: var(--accent-light);
            color: var(--accent);
            font-size: 0.7rem;
            font-weight: 600;
            padding: 0.15rem 0.5rem;
            border-radius: 99px;
            text-transform: uppercase;
            letter-spacing: 0.03em;
          }
          .contributed-badge {
            background: #fef3c7;
            color: #b45309;
            font-size: 0.7rem;
            font-weight: 600;
            padding: 0.15rem 0.5rem;
            border-radius: 99px;
            letter-spacing: 0.02em;
          }

          /* Empty state */
          .empty-state {
            text-align: center;
            padding: 4rem 2rem;
            color: var(--text-muted);
          }
          .empty-state h3 {
            font-family: var(--font-heading);
            font-size: 1.25rem;
            color: var(--text-secondary);
            margin-bottom: 0.5rem;
          }

          /* Footer */
          .site-footer {
            max-width: 1080px;
            margin: 0 auto;
            padding: 2rem 1.5rem;
            border-top: 1px solid var(--border);
            text-align: center;
            font-size: 0.8rem;
            color: var(--text-muted);
          }
          .site-footer a { color: var(--text-muted); }
          .site-footer a:hover { color: var(--text-secondary); }

          /* Responsive */
          @media (max-width: 640px) {
            .featured-image { height: 200px; }
            .featured-title { font-size: 1.5rem; }
            .article-thumb { width: 88px; height: 60px; }
            .stats-bar { gap: 1rem; flex-wrap: wrap; }
          }

          /* Topic pills */
          .topic-bar {
            max-width: 1080px;
            margin: 0 auto;
            padding: 0.75rem 1.5rem;
            display: flex;
            gap: 0.5rem;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }
          .topic-bar::-webkit-scrollbar { display: none; }
          .topic-pill {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            padding: 0.35rem 0.85rem;
            border-radius: 99px;
            border: 1px solid var(--border);
            background: white;
            color: var(--text-secondary);
            font-size: 0.8rem;
            font-weight: 500;
            text-decoration: none;
            white-space: nowrap;
            transition: all 0.15s;
            flex-shrink: 0;
          }
          .topic-pill:hover {
            border-color: var(--accent);
            color: var(--accent);
          }
          .topic-pill.active {
            background: var(--accent);
            color: white;
            border-color: var(--accent);
          }
          .topic-pill.active .topic-count {
            background: rgba(255,255,255,0.25);
            color: white;
          }
          .topic-count {
            font-size: 0.65rem;
            font-weight: 600;
            background: var(--accent-light);
            color: var(--accent);
            padding: 0.1rem 0.4rem;
            border-radius: 99px;
          }

          /* Like button */
          .like-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.3rem;
            background: none;
            border: 1px solid var(--border);
            border-radius: 99px;
            padding: 0.2rem 0.6rem;
            cursor: pointer;
            color: var(--text-muted);
            font-size: 0.75rem;
            font-family: var(--font-sans);
            font-weight: 500;
            transition: all 0.2s;
            line-height: 1;
            flex-shrink: 0;
          }
          .like-btn:hover {
            border-color: var(--accent);
            color: var(--accent);
          }
          .like-btn.liked {
            background: var(--accent-light);
            border-color: var(--accent);
            color: var(--accent);
          }
          .like-count:empty { display: none; }        `}} />
      </head>
      <body>
        <header class="site-header">
          <div class="header-inner">
            <a href="/" class="site-logo">open<span>.</span>news</a>
            <nav class="header-nav">
              {isLoggedIn ? (
                <a href="/chat">Dashboard</a>
              ) : (
                <a href="/login">Sign In</a>
              )}
            </nav>
          </div>
        </header>

        <div class="stats-bar">
          <span><strong>{stats.totalTracks}</strong> active tracks</span>
          <span><strong>{stats.articlesToday}</strong> articles today</span>
          <span><strong>{stats.activeTopics}</strong> topics active</span>
        </div>

        <div class="view-tabs">
          <a href="/?view=convergence" class={`view-tab ${view === 'convergence' && !activeTopic ? 'active' : ''}`}>For You</a>
          <a href="/?view=latest" class={`view-tab ${view === 'latest' && !activeTopic ? 'active' : ''}`}>Latest</a>
        </div>

        {topics.length > 0 && (
          <div class="topic-bar">
            {topics.map((t) => (
              <a
                href={`/?topic=${t.id}`}
                class={`topic-pill ${activeTopic === t.id ? 'active' : ''}`}
              >
                {t.label}
                <span class="topic-count">{t.articleCount}</span>
              </a>
            ))}
          </div>
        )}

        <main class="main-content">
          {articles.length === 0 ? (
            <div class="empty-state">
              <h3>No articles yet</h3>
              <p>Articles will appear here as community tracks surface them from the network.</p>
            </div>
          ) : (
            <div>
              {featured && <ArticleCard article={featured} featured={true} userContributed={userContributedIds?.has(featured.id)} isLoggedIn={isLoggedIn} />}
              <div class="articles-grid">
                {rest.map((a) => (
                  <ArticleCard article={a} userContributed={userContributedIds?.has(a.id)} isLoggedIn={isLoggedIn} />
                ))}
              </div>
            </div>
          )}
        </main>

        <footer class="site-footer">
          <p>
            Surfaced by the collective intelligence of community topic trackers on the AT Protocol network.
          </p>
          <p style="margin-top: 0.5rem">
            <a href="/privacy">Privacy</a> &middot; <a href="/tos">Terms</a> &middot; <a href="mailto:app@track.social">Contact</a>
          </p>
        </footer>

        <script dangerouslySetInnerHTML={{__html: `
          function handleLike(e, btn) {
            e.preventDefault();
            e.stopPropagation();

            var articleId = btn.dataset.articleId;
            var isLoggedIn = btn.dataset.loggedIn === 'true';

            if (!isLoggedIn) {
              // Redirect to login, then back here with pending like
              var returnUrl = window.location.pathname + window.location.search;
              var sep = returnUrl.indexOf('?') === -1 ? '?' : '&';
              window.location.href = '/login?returnTo=' + encodeURIComponent(returnUrl + sep + 'pendingLike=' + articleId);
              return;
            }

            // Optimistic toggle
            var svg = btn.querySelector('svg');
            var count = btn.querySelector('.like-count');
            var isLiked = btn.classList.contains('liked');
            btn.classList.toggle('liked');
            svg.setAttribute('fill', isLiked ? 'none' : 'currentColor');

            var currentCount = parseInt(count.textContent) || 0;
            var newCount = isLiked ? Math.max(0, currentCount - 1) : currentCount + 1;
            count.textContent = newCount > 0 ? newCount : '';

            fetch('/api/articles/' + articleId + '/like', { method: 'POST' })
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (data.error) {
                  // Revert
                  btn.classList.toggle('liked');
                  svg.setAttribute('fill', isLiked ? 'currentColor' : 'none');
                  count.textContent = currentCount > 0 ? currentCount : '';
                } else {
                  // Sync with server count
                  count.textContent = data.count > 0 ? data.count : '';
                  btn.classList.toggle('liked', data.liked);
                  svg.setAttribute('fill', data.liked ? 'currentColor' : 'none');
                }
              })
              .catch(function() {
                btn.classList.toggle('liked');
                svg.setAttribute('fill', isLiked ? 'currentColor' : 'none');
                count.textContent = currentCount > 0 ? currentCount : '';
              });
          }

          // Auto-execute pending like after login redirect
          (function() {
            var params = new URLSearchParams(window.location.search);
            var pendingLike = params.get('pendingLike');
            if (pendingLike) {
              // Clean the URL
              params.delete('pendingLike');
              var clean = window.location.pathname;
              var remaining = params.toString();
              if (remaining) clean += '?' + remaining;
              window.history.replaceState({}, '', clean);

              // Find and click the like button
              var btn = document.querySelector('.like-btn[data-article-id="' + pendingLike + '"]');
              if (btn && !btn.classList.contains('liked')) {
                btn.click();
              }
            }
          })();
        `}} />
      </body>
    </html>
  );
}

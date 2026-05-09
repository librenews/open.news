/** @jsxImportSource hono/jsx */

export interface LongformStory {
  uri: string;
  authorDid: string;
  authorHandle: string;
  authorAvatar: string;
  authorName: string;
  title: string;
  description: string | null;
  publishedAt: string | null;
  site: string | null;
  path: string | null;
  wordCount: number;
}

export interface TopicGroup {
  label: string;
  count: number;
  slug: string;
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

function StoryCard({ story, domain }: { story: LongformStory; domain: string }) {
  const ago = timeAgo(story.publishedAt);
  const minRead = Math.max(1, Math.ceil(story.wordCount / 200));
  const rkey = story.uri.split('/').pop();

  // Link to site+path if available, otherwise longform reader
  const readUrl = (story.site && story.path && story.site.startsWith('http'))
    ? `${story.site}${story.path}`
    : `https://${domain}/post/${story.authorDid}/${rkey}`;

  return (
    <article class="story-card">
      <a href={readUrl} class="story-link" target="_blank" rel="noopener noreferrer">
        <h3 class="story-title">{story.title || 'Untitled'}</h3>
        {story.description && (
          <p class="story-excerpt">{story.description.length > 200 ? story.description.substring(0, 200) + '…' : story.description}</p>
        )}
      </a>
      <div class="story-meta">
        <a href={`/@${story.authorHandle}`} class="author-link">
          {story.authorAvatar ? (
            <img src={story.authorAvatar} alt="" class="author-avatar" />
          ) : (
            <div class="author-avatar-placeholder">{(story.authorName || story.authorHandle).charAt(0).toUpperCase()}</div>
          )}
          <span class="author-name">{story.authorName || story.authorHandle}</span>
        </a>
        <span class="meta-dot">·</span>
        {ago && <span class="story-time">{ago}</span>}
        <span class="meta-dot">·</span>
        <span class="story-read-time">{minRead} min read</span>
      </div>
    </article>
  );
}

export function HomePage({
  stories,
  topics,
  view,
  profile,
  domain,
}: {
  stories: LongformStory[];
  topics: TopicGroup[];
  view: 'latest' | 'foryou';
  profile?: { displayName: string; avatar: string; handle: string } | null;
  domain: string;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Longform — Long-form writing on the AT Protocol</title>
        <meta name="description" content="Discover and publish long-form writing on the open AT Protocol network." />
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

          /* Three-column layout */
          .app-shell {
            display: flex;
            min-height: 100vh;
            max-width: 1280px;
            margin: 0 auto;
          }

          /* Left nav */
          .left-nav {
            width: 220px;
            flex-shrink: 0;
            padding: 2rem 1.5rem;
            border-right: 1px solid var(--border);
            position: sticky;
            top: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
          }
          .nav-logo {
            font-family: var(--font-body);
            font-weight: 700;
            font-size: 1.35rem;
            color: var(--text-main);
            text-decoration: none;
            letter-spacing: -0.03em;
            margin-bottom: 2.5rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          .nav-logo img {
            height: 28px;
            width: auto;
          }
          .nav-items {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
            flex: 1;
          }
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
          .nav-item:hover {
            background: var(--bg-secondary);
            color: var(--text-main);
          }
          .nav-item.active {
            background: var(--bg-secondary);
            color: var(--text-main);
            font-weight: 600;
          }
          .nav-item svg {
            width: 20px;
            height: 20px;
            flex-shrink: 0;
          }
          .nav-footer {
            padding-top: 1.5rem;
            border-top: 1px solid var(--border);
          }
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
          .nav-write-btn:hover {
            background: var(--accent-hover);
          }

          /* Center column */
          .center-content {
            flex: 1;
            min-width: 0;
            border-right: 1px solid var(--border);
          }
          .center-header {
            position: sticky;
            top: 0;
            background: var(--bg);
            z-index: 10;
            border-bottom: 1px solid var(--border);
          }
          .center-tabs {
            display: flex;
          }
          .center-tab {
            flex: 1;
            text-align: center;
            padding: 1rem 1.5rem;
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--text-muted);
            text-decoration: none;
            border-bottom: 2px solid transparent;
            transition: all 0.15s;
          }
          .center-tab:hover {
            color: var(--text-secondary);
            background: var(--bg-secondary);
          }
          .center-tab.active {
            color: var(--text-main);
            border-bottom-color: var(--text-main);
          }
          .stories-list {
            padding: 0;
          }

          /* Story card */
          .story-card {
            padding: 1.5rem 1.75rem;
            border-bottom: 1px solid var(--border);
            transition: background 0.15s;
          }
          .story-card:hover {
            background: var(--bg-secondary);
          }
          .story-link {
            text-decoration: none;
            color: inherit;
            display: block;
          }
          .story-title {
            font-family: var(--font-body);
            font-size: 1.2rem;
            font-weight: 700;
            line-height: 1.4;
            letter-spacing: -0.01em;
            margin-bottom: 0.5rem;
          }
          .story-excerpt {
            font-family: var(--font-body);
            font-size: 0.875rem;
            font-weight: 300;
            line-height: 1.65;
            color: var(--text-secondary);
            margin-bottom: 0.75rem;
          }
          .story-meta {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.8rem;
            color: var(--text-muted);
          }
          .author-link {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            text-decoration: none;
            color: var(--text-secondary);
            font-weight: 500;
          }
          .author-link:hover {
            color: var(--text-main);
          }
          .author-avatar {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            object-fit: cover;
          }
          .author-avatar-placeholder {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: var(--text-muted);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--bg);
            font-size: 0.65rem;
            font-weight: 700;
          }
          .meta-dot {
            color: var(--text-muted);
          }
          .story-read-time {
            color: var(--text-muted);
          }

          /* Right column */
          .right-sidebar {
            width: 280px;
            flex-shrink: 0;
            padding: 1.5rem;
            position: sticky;
            top: 0;
            height: 100vh;
            overflow-y: auto;
          }
          .sidebar-section {
            margin-bottom: 2rem;
          }
          .sidebar-title {
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--text-muted);
            margin-bottom: 0.75rem;
            padding: 0 0.5rem;
          }
          .topic-list {
            display: flex;
            flex-direction: column;
            gap: 0.15rem;
          }
          .topic-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.55rem 0.75rem;
            border-radius: 8px;
            text-decoration: none;
            color: var(--text-secondary);
            font-size: 0.85rem;
            font-weight: 500;
            transition: all 0.15s;
          }
          .topic-item:hover {
            background: var(--bg-secondary);
            color: var(--text-main);
          }
          .topic-count {
            font-size: 0.7rem;
            font-weight: 600;
            color: var(--text-muted);
            background: var(--bg-secondary);
            padding: 0.15rem 0.5rem;
            border-radius: 99px;
          }

          /* User card in sidebar */
          .user-card {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.75rem;
            border-radius: 10px;
            background: var(--bg-secondary);
            margin-bottom: 1.5rem;
          }
          .user-card-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            object-fit: cover;
          }
          .user-card-info {
            flex: 1;
            min-width: 0;
          }
          .user-card-name {
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-main);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .user-card-handle {
            font-size: 0.75rem;
            color: var(--text-muted);
          }
          .user-card {
            position: relative;
            cursor: pointer;
          }
          .user-card-dropdown {
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 10px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.12);
            overflow: hidden;
            margin-top: 0.25rem;
            z-index: 50;
          }
          .user-card:hover .user-card-dropdown {
            display: block;
          }
          .user-card-dropdown a {
            display: block;
            padding: 0.6rem 1rem;
            font-size: 0.85rem;
            color: var(--text-secondary);
            text-decoration: none;
            font-weight: 500;
            transition: background 0.1s;
          }
          .user-card-dropdown a:hover {
            background: var(--bg-secondary);
          }
          .user-card-dropdown .signout-link {
            color: #d32f2f;
            border-top: 1px solid var(--border);
          }
          @media (prefers-color-scheme: dark) {
            .user-card-dropdown {
              box-shadow: 0 4px 16px rgba(0,0,0,0.4);
            }
          }

          /* Empty state */
          .empty-state {
            text-align: center;
            padding: 4rem 2rem;
            color: var(--text-muted);
          }
          .empty-state h3 {
            font-family: var(--font-body);
            font-size: 1.1rem;
            color: var(--text-secondary);
            margin-bottom: 0.5rem;
          }

          /* Responsive */
          @media (max-width: 1024px) {
            .right-sidebar { display: none; }
          }
          @media (max-width: 768px) {
            .left-nav { display: none; }
            .center-content { border-right: none; }
          }
        `}} />
      </head>
      <body>
        <div class="app-shell">
          {/* Left Navigation */}
          <nav class="left-nav">
            <a href="/" class="nav-logo">
              <img src="/logo.png" alt="Longform" onerror="this.outerHTML='<span>Longform</span>'" />
            </a>

            <div class="nav-items">
              <a href="/" class="nav-item active">
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
                <a href={`/@${profile.handle}`} class="nav-item">
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
                <a href="/login" class="nav-write-btn">
                  Sign In
                </a>
              )}
            </div>
          </nav>

          {/* Center Column */}
          <main class="center-content">
            <div class="center-header">
              <div class="center-tabs">
                <a href="/?view=latest" class={`center-tab ${view === 'latest' ? 'active' : ''}`}>Latest</a>
                <a href="/?view=foryou" class={`center-tab ${view === 'foryou' ? 'active' : ''}`}>For You</a>
              </div>
            </div>

            <div class="stories-list">
              {stories.length === 0 ? (
                <div class="empty-state">
                  <h3>No stories yet</h3>
                  <p>Long-form articles from the AT Protocol network will appear here.</p>
                </div>
              ) : (
                stories.map((s) => <StoryCard story={s} domain={domain} />)
              )}
            </div>
          </main>

          {/* Right Sidebar */}
          <aside class="right-sidebar">
            {profile ? (
              <div class="user-card">
                {profile.avatar ? (
                  <img src={profile.avatar} alt="" class="user-card-avatar" />
                ) : (
                  <div class="author-avatar-placeholder" style="width: 36px; height: 36px; font-size: 0.85rem;">
                    {profile.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div class="user-card-info">
                  <div class="user-card-name">{profile.displayName}</div>
                  <div class="user-card-handle">@{profile.handle}</div>
                </div>
                <div class="user-card-dropdown">
                  <a href={`/@${profile.handle}`}>Profile</a>
                  <a href="/posts">My Stories</a>
                  <a href="/logout" class="signout-link">Sign out</a>
                </div>
              </div>
            ) : (
              <div class="sidebar-section">
                <a href="/login" class="nav-write-btn" style="margin-bottom: 0.75rem;">
                  Sign in to write
                </a>
                <p style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.5; text-align: center;">
                  Use your Bluesky or AT Protocol identity
                </p>
              </div>
            )}

            {topics.length > 0 && (
              <div class="sidebar-section">
                <h2 class="sidebar-title">Topics</h2>
                <div class="topic-list">
                  {topics.map((t) => (
                    <a href={`/topic/${t.slug}`} class="topic-item">
                      {t.label}
                      <span class="topic-count">{t.count}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div class="sidebar-section" style="margin-top: 2rem;">
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

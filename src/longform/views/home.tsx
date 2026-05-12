/** @jsxImportSource hono/jsx */
import { Layout } from './layout.js';
import { TopHeader, TopHeaderStyles } from './partials.js';

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
  imageUrl: string | null;
  externalUrl: string | null;
  publicationUri: string | null;
}

export interface TopicGroup {
  label: string;
  count: number;
  slug: string;
}

export interface PopularPost {
  uri: string;
  authorDid: string;
  authorName: string;
  authorHandle: string;
  authorAvatar: string;
  title: string;
  publishedAt: string | null;
  likeCount: number;
  repostCount: number;
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

  // Use pre-computed externalUrl, or fall back to longform reader for Leaflet
  const readUrl = story.externalUrl
    || `https://${domain}/post/${story.authorDid}/${rkey}`;

  return (
    <article class="story-card" style="display: flex; flex-direction: column;">
      <div class="story-card-inner">
        <div class="story-card-text">
          <a href={readUrl} class="story-link">
            <h3 class="story-title">{story.title || 'Untitled'}</h3>
            {story.description && (
              <p class="story-excerpt">{story.description.length > 200 ? story.description.substring(0, 200) + '…' : story.description}</p>
            )}
          </a>
        </div>
        {story.imageUrl && (
          <a href={readUrl} class="story-thumb">
            <img src={story.imageUrl} alt="" loading="lazy" />
          </a>
        )}
      </div>
      <div class="story-meta" style="margin-top: 0.85rem; display: flex; align-items: center; justify-content: space-between; width: 100%;">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <a href={`/profile/${story.authorHandle}`} class="author-link">
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
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <button onclick={`handleListAction(this, 'like', '${story.authorDid}', '${rkey}', '${(story.title || '').replace(/'/g, "\\'")}')`} style="background: none; border: none; cursor: pointer; color: inherit; padding: 0; display: flex; align-items: center; transition: color 0.15s;" onmouseover="if(!this.dataset.active) this.style.color='#f02050'" onmouseout="if(!this.dataset.active) this.style.color='inherit'" title="Like">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" class="icon"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
          </button>
          <button onclick={`handleListAction(this, 'repost', '${story.authorDid}', '${rkey}', '${(story.title || '').replace(/'/g, "\\'")}')`} style="background: none; border: none; cursor: pointer; color: inherit; padding: 0; display: flex; align-items: center; transition: color 0.15s;" onmouseover="if(!this.dataset.active) this.style.color='#20d070'" onmouseout="if(!this.dataset.active) this.style.color='inherit'" title="Repost">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
          </button>
          {story.publicationUri && (
            <button
              class="follow-btn"
              data-publication={story.publicationUri}
              onclick="window.handleFollow(this)"
            >
              Follow
            </button>
          )}
        </div>
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
  hasSubscriptions,
  popularPosts,
}: {
  stories: LongformStory[];
  topics: TopicGroup[];
  view: 'latest' | 'foryou' | 'following';
  profile?: { displayName: string; avatar: string; handle: string } | null;
  domain: string;
  hasSubscriptions?: boolean;
  popularPosts?: PopularPost[];
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
            padding: 1.5rem 1.5rem;
            border-right: 1px solid var(--border);
            position: sticky;
            top: 49px;
            height: calc(100vh - 49px);
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
          .story-card-inner {
            display: flex;
            gap: 1.25rem;
            align-items: flex-start;
          }
          .story-card-text {
            flex: 1;
            min-width: 0;
          }
          .story-thumb {
            flex-shrink: 0;
            width: 160px;
            height: 106px;
            border-radius: 6px;
            overflow: hidden;
          }
          .story-thumb img {
            width: 100%;
            height: 100%;
            object-fit: cover;
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
          .follow-btn {
            margin-left: auto;
            padding: 0.25rem 0.75rem;
            border: 1px solid var(--border);
            border-radius: 99px;
            background: transparent;
            color: var(--text-secondary);
            font-size: 0.7rem;
            font-weight: 600;
            font-family: var(--font-sans);
            cursor: pointer;
            transition: all 0.15s;
            white-space: nowrap;
          }
          .follow-btn:hover {
            background: var(--bg-secondary);
            color: var(--text-main);
            border-color: var(--text-muted);
          }
          .follow-btn.following {
            background: var(--accent);
            color: var(--bg);
            border-color: var(--accent);
          }
          .follow-btn.following:hover {
            background: #d32f2f;
            border-color: #d32f2f;
          }

          /* Right column */
          .right-sidebar {
            width: 280px;
            flex-shrink: 0;
            padding: 1.5rem;
            position: sticky;
            top: 49px;
            height: calc(100vh - 49px);
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
            z-index: 50;
            padding-top: 0;
          }
          .user-card-dropdown::before {
            content: '';
            position: absolute;
            top: -8px;
            left: 0;
            right: 0;
            height: 8px;
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

          /* Popular posts sidebar */
          .popular-post-item {
            display: flex;
            gap: 0.65rem;
            align-items: flex-start;
            padding: 0.6rem 0.5rem;
            border-radius: 8px;
            text-decoration: none;
            color: inherit;
            transition: background 0.15s;
          }
          .popular-post-item:hover {
            background: var(--bg-secondary);
          }
          .popular-post-rank {
            font-size: 0.8rem;
            font-weight: 700;
            color: var(--text-muted);
            min-width: 1.25rem;
            text-align: right;
            padding-top: 0.1rem;
          }
          .popular-post-avatar {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
          }
          .popular-post-avatar-placeholder {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: var(--border);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
            font-size: 0.6rem;
            font-weight: 700;
            flex-shrink: 0;
          }
          .popular-post-text {
            flex: 1;
            min-width: 0;
          }
          .popular-post-title {
            font-size: 0.82rem;
            font-weight: 600;
            color: var(--text-main);
            line-height: 1.3;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }
          .popular-post-meta {
            font-size: 0.7rem;
            color: var(--text-muted);
            margin-top: 0.2rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          .popular-post-stat {
            display: flex;
            align-items: center;
            gap: 0.2rem;
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
          ${TopHeaderStyles}
        `}} />
      </head>
      <body>
        <TopHeader profile={profile} />

        <div class="app-shell">
          {/* Left Navigation */}
          <nav class="left-nav">
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
                <a href={`/profile/${profile.handle}`} class="nav-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Profile
                </a>
              )}
              {profile && (
                <a href="/subscriptions" class="nav-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 11a9 9 0 0 1 9 9" />
                    <path d="M4 4a16 16 0 0 1 16 16" />
                    <circle cx="5" cy="19" r="1" />
                  </svg>
                  Subscriptions
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
                {profile && <a href="/?view=following" class={`center-tab ${view === 'following' ? 'active' : ''}`}>Following</a>}
              </div>
            </div>

            <div class="stories-list">
              {view === 'following' && !profile ? (
                <div class="empty-state">
                  <h3>Sign in to see your feed</h3>
                  <p>Follow publications to see their stories here.</p>
                  <a href="/login" style="display: inline-block; margin-top: 0.75rem; padding: 0.5rem 1.25rem; background: var(--accent); color: var(--bg); border-radius: 99px; font-size: 0.85rem; font-weight: 600; text-decoration: none;">Sign In</a>
                </div>
              ) : view === 'following' && stories.length === 0 ? (
                <div class="empty-state">
                  <h3>No stories from followed publications</h3>
                  <p>Follow publications on story cards to see their articles here.</p>
                  <a href="/?view=latest" style="display: inline-block; margin-top: 0.75rem; color: var(--text-secondary); font-size: 0.85rem; text-decoration: underline;">Browse latest stories →</a>
                </div>
              ) : stories.length === 0 ? (
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
            {(popularPosts && popularPosts.length > 0) && (
              <div class="sidebar-section">
                <h2 class="sidebar-title">Popular</h2>
                <div style="display: flex; flex-direction: column;">
                  {popularPosts.map((post, i) => {
                    const rkey = post.uri.split('/').pop();
                    const url = `/post/${post.authorDid}/${rkey}`;
                    return (
                      <a href={url} class="popular-post-item">
                        <span class="popular-post-rank">{i + 1}</span>
                        {post.authorAvatar ? (
                          <img src={post.authorAvatar} alt="" class="popular-post-avatar" />
                        ) : (
                          <div class="popular-post-avatar-placeholder">{(post.authorName || post.authorHandle).charAt(0).toUpperCase()}</div>
                        )}
                        <div class="popular-post-text">
                          <div class="popular-post-title">{post.title || 'Untitled'}</div>
                          <div class="popular-post-meta">
                            <span>{post.authorName || post.authorHandle}</span>
                            {post.likeCount > 0 && (
                              <span class="popular-post-stat">
                                <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                                {post.likeCount}
                              </span>
                            )}
                            {post.repostCount > 0 && (
                              <span class="popular-post-stat">
                                <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M17 1l4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="M7 23l-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                                {post.repostCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </a>
                    );
                  })}
                </div>
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
          </aside>
        </div>
        <script dangerouslySetInnerHTML={{__html: `
          // Follow button logic
          window.handleFollow = async function(btn) {
            const pub = btn.dataset.publication;
            if (!pub) return;
            btn.disabled = true;

            if (btn.classList.contains('following')) {
              // Unsubscribe
              const rkey = btn.dataset.rkey;
              if (!rkey) return;
              try {
                const res = await fetch('/api/unsubscribe', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ rkey })
                });
                if (res.ok) {
                  btn.classList.remove('following');
                  btn.textContent = 'Follow';
                  btn.dataset.rkey = '';
                }
              } catch(e) {}
            } else {
              // Subscribe
              try {
                const res = await fetch('/api/subscribe', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ publication: pub })
                });
                const data = await res.json();
                if (data.ok) {
                  btn.classList.add('following');
                  btn.textContent = 'Following';
                  btn.dataset.rkey = data.rkey;
                }
              } catch(e) {}
            }
            btn.disabled = false;
          };

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

          // Check subscription status on load
          document.addEventListener('DOMContentLoaded', async () => {
            const btns = document.querySelectorAll('.follow-btn[data-publication]');
            const pubs = [...new Set([...btns].map(b => b.dataset.publication))];
            for (const pub of pubs) {
              try {
                const res = await fetch('/api/subscription-status?publication=' + encodeURIComponent(pub));
                const data = await res.json();
                if (data.subscribed) {
                  btns.forEach(b => {
                    if (b.dataset.publication === pub) {
                      b.classList.add('following');
                      b.textContent = 'Following';
                      b.dataset.rkey = data.rkey;
                    }
                  });
                }
              } catch(e) {}
            }
          });
        `}} />
      </body>
    </html>
  );
}

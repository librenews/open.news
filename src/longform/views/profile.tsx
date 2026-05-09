/** @jsxImportSource hono/jsx */
import type { LongformStory } from './home.js';

export interface ProfileData {
  did: string;
  handle: string;
  displayName: string;
  avatar: string;
  description: string;
  followersCount: number;
  followsCount: number;
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

export function ProfilePage({
  author,
  stories,
  sessionProfile,
  domain,
}: {
  author: ProfileData;
  stories: LongformStory[];
  sessionProfile?: { displayName: string; avatar: string; handle: string } | null;
  domain: string;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{author.displayName} — Longform</title>
        <meta name="description" content={author.description || `${author.displayName}'s long-form writing on the AT Protocol.`} />
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

          /* Top header */
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
          @media (max-width: 768px) {
            .top-header-search { display: none; }
          }
          @media (prefers-color-scheme: dark) {
            .top-header-dropdown { box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
          }

          /* Profile layout */
          .profile-layout {
            max-width: 720px;
            margin: 0 auto;
            padding: 2rem 1.5rem;
          }

          /* Profile header */
          .profile-header {
            display: flex;
            gap: 1.5rem;
            margin-bottom: 2.5rem;
            padding-bottom: 2rem;
            border-bottom: 1px solid var(--border);
          }
          .profile-avatar {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
          }
          .profile-avatar-placeholder {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: var(--text-muted);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--bg);
            font-size: 2rem;
            font-weight: 700;
            flex-shrink: 0;
          }
          .profile-info {
            flex: 1;
            min-width: 0;
          }
          .profile-name {
            font-family: var(--font-sans);
            font-size: 1.5rem;
            font-weight: 700;
            letter-spacing: -0.02em;
            margin-bottom: 0.25rem;
          }
          .profile-handle {
            font-size: 0.9rem;
            color: var(--text-muted);
            margin-bottom: 0.75rem;
          }
          .profile-handle a {
            color: var(--text-muted);
            text-decoration: none;
          }
          .profile-handle a:hover {
            color: var(--text-secondary);
            text-decoration: underline;
          }
          .profile-bio {
            font-size: 0.9rem;
            line-height: 1.6;
            color: var(--text-secondary);
            margin-bottom: 0.75rem;
          }
          .profile-stats {
            display: flex;
            gap: 1.25rem;
            font-size: 0.85rem;
            color: var(--text-muted);
          }
          .profile-stats strong {
            color: var(--text-main);
            font-weight: 600;
          }

          /* Stories */
          .profile-stories-title {
            font-size: 0.75rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--text-muted);
            margin-bottom: 1rem;
          }
          .story-item {
            padding: 1.25rem 0;
            border-bottom: 1px solid var(--border);
            display: flex;
            gap: 1.25rem;
            align-items: flex-start;
          }
          .story-item:first-child {
            padding-top: 0;
          }
          .story-item-content {
            flex: 1;
            min-width: 0;
          }
          .story-item a {
            text-decoration: none;
            color: inherit;
          }
          .story-item-title {
            font-family: var(--font-body);
            font-size: 1.1rem;
            font-weight: 700;
            line-height: 1.4;
            margin-bottom: 0.35rem;
            transition: color 0.15s;
          }
          .story-item a:hover .story-item-title {
            color: var(--text-secondary);
          }
          .story-item-meta {
            font-size: 0.8rem;
            color: var(--text-muted);
            display: flex;
            gap: 0.5rem;
            align-items: center;
          }
          .story-item-excerpt {
            font-family: var(--font-body);
            font-size: 0.85rem;
            font-weight: 300;
            line-height: 1.6;
            color: var(--text-secondary);
            margin-bottom: 0.5rem;
          }
          .story-item-thumb {
            flex-shrink: 0;
            width: 100px;
            height: 68px;
            border-radius: 6px;
            overflow: hidden;
          }
          .story-item-thumb img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
          .empty-profile {
            text-align: center;
            padding: 3rem 2rem;
            color: var(--text-muted);
          }
          .empty-profile h3 {
            font-family: var(--font-body);
            font-size: 1.1rem;
            color: var(--text-secondary);
            margin-bottom: 0.5rem;
          }
          @media (max-width: 640px) {
            .profile-header {
              flex-direction: column;
              align-items: center;
              text-align: center;
            }
            .profile-stats { justify-content: center; }
          }
        `}} />
      </head>
      <body>
        {/* Top navigation header */}
        <header class="top-header">
          <a href="/" class="top-header-logo">
            <img src="/logo.png" alt="Longform" onerror="this.outerHTML='<span>Longform</span>'" />
          </a>
          <form class="top-header-search" action="/search" method="get">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input type="text" name="q" placeholder="Search articles..." />
          </form>
          <div class="top-header-links">
            <a href="/">Home</a>
            <a href="/posts">Stories</a>
          </div>
          <div class="top-header-right">
            {sessionProfile ? (
              <div class="top-header-user">
                {sessionProfile.avatar ? (
                  <img src={sessionProfile.avatar} alt="" />
                ) : (
                  <div class="top-header-user-placeholder">
                    {sessionProfile.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div class="top-header-dropdown">
                  <div style="padding: 0.6rem 1rem; border-bottom: 1px solid var(--border);">
                    <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-main);">{sessionProfile.displayName}</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted);">@{sessionProfile.handle}</div>
                  </div>
                  <a href={`/@${sessionProfile.handle}`}>Profile</a>
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

        <div class="profile-layout">
          <div class="profile-header">
            {author.avatar ? (
              <img src={author.avatar} alt="" class="profile-avatar" />
            ) : (
              <div class="profile-avatar-placeholder">
                {author.displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div class="profile-info">
              <h1 class="profile-name">{author.displayName}</h1>
              <div class="profile-handle">
                <a href={`https://bsky.app/profile/${author.handle}`} target="_blank" rel="noopener noreferrer">@{author.handle}</a>
              </div>
              {author.description && <p class="profile-bio">{author.description}</p>}
              <div class="profile-stats">
                <span><strong>{author.followersCount}</strong> followers</span>
                <span><strong>{author.followsCount}</strong> following</span>
                <span><strong>{stories.length}</strong> {stories.length === 1 ? 'story' : 'stories'}</span>
              </div>
            </div>
          </div>

          <h2 class="profile-stories-title">Longform Stories</h2>

          {stories.length === 0 ? (
            <div class="empty-profile">
              <h3>No longforms yet</h3>
              <p>{author.displayName} hasn't published any long-form articles on the AT Protocol.</p>
            </div>
          ) : (
            stories.map((s) => {
              const rkey = s.uri.split('/').pop();
              const readUrl = s.externalUrl
                || `https://${domain}/post/${s.authorDid}/${rkey}`;
              const minRead = Math.max(1, Math.ceil(s.wordCount / 200));
              const ago = timeAgo(s.publishedAt);

              return (
                <div class="story-item">
                  <div class="story-item-content">
                    <a href={readUrl} target="_blank" rel="noopener noreferrer">
                      <h3 class="story-item-title">{s.title || 'Untitled'}</h3>
                      {s.description && (
                        <p class="story-item-excerpt">
                          {s.description.length > 200 ? s.description.substring(0, 200) + '…' : s.description}
                        </p>
                      )}
                      <div class="story-item-meta">
                        {ago && <span>{ago}</span>}
                        {ago && <span>·</span>}
                        <span>{minRead} min read</span>
                        <span>·</span>
                        <span>{s.wordCount} words</span>
                      </div>
                    </a>
                  </div>
                  {s.imageUrl && (
                    <a href={readUrl} class="story-item-thumb" target="_blank" rel="noopener noreferrer">
                      <img src={s.imageUrl} alt="" loading="lazy" />
                    </a>
                  )}
                </div>
              );
            })
          )}
        </div>
      </body>
    </html>
  );
}

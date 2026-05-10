/** @jsxImportSource hono/jsx */

/**
 * Shared UI partials for Centipedia views.
 * All pages should import from here instead of duplicating layout code.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UserProfile {
  displayName: string;
  avatar: string;
  handle: string;
}

// ─── Base CSS Variables & Reset ─────────────────────────────────────────────

export const BASE_STYLES = `
:root {
  --bg: #ffffff; --bg-secondary: #f8f9fa; --text-main: #1a1a1a;
  --text-secondary: #6b7280; --text-muted: #9ca3af; --border: #e5e7eb;
  --accent: #111827; --accent-hover: #374151;
  --font-body: 'Merriweather', Georgia, serif;
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --header-height: 57px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f0f0f; --bg-secondary: #1a1a1a;
    --text-main: rgba(255,255,255,0.92); --text-secondary: rgba(255,255,255,0.6);
    --text-muted: rgba(255,255,255,0.4); --border: rgba(255,255,255,0.08);
    --accent: #ffffff; --accent-hover: rgba(255,255,255,0.85);
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { overflow-y: scroll; }
body { font-family: var(--font-sans); background: var(--bg); color: var(--text-main); -webkit-font-smoothing: antialiased; }
`;

// ─── Header Styles ──────────────────────────────────────────────────────────

export const HEADER_STYLES = `
.top-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 2rem; border-bottom: 1px solid var(--border); font-family: var(--font-sans); position: sticky; top: 0; background: var(--bg); z-index: 20; height: var(--header-height); }
.top-header-logo { font-family: var(--font-body); font-weight: 700; font-size: 1.2rem; color: var(--text-main); text-decoration: none; display: flex; align-items: center; gap: 0.5rem; }
.top-header-logo img { height: 40px; width: auto; }
.top-header-search { display: flex; align-items: center; flex: 1; max-width: 320px; margin: 0 0 0 1rem; position: relative; }
.top-header-search .search-icon { position: absolute; left: 0.6rem; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; color: var(--text-muted); pointer-events: none; }
.top-header-search input { width: 100%; padding: 0.45rem 0.75rem 0.45rem 2rem; border: 1px solid var(--border); border-radius: 20px; font-size: 0.8rem; font-family: var(--font-sans); background: var(--bg-secondary); color: var(--text-main); outline: none; transition: border-color 0.15s, background 0.15s; }
.top-header-search input:focus { border-color: var(--text-muted); background: var(--bg); }
.top-header-search input::placeholder { color: var(--text-muted); }
.top-header-right { display: flex; align-items: center; gap: 1rem; }
.top-header-links { display: flex; gap: 1.25rem; align-items: center; }
.top-header-links a { color: var(--text-secondary); text-decoration: none; font-size: 0.85rem; font-weight: 500; transition: color 0.15s; }
.top-header-links a:hover { color: var(--text-main); }
.top-header-signin { padding: 0.4rem 1rem; background: var(--accent); color: var(--bg); border: none; border-radius: 99px; font-size: 0.8rem; font-weight: 600; font-family: var(--font-sans); text-decoration: none; transition: background 0.15s; }
.top-header-signin:hover { opacity: 0.85; }
.top-header-user { position: relative; cursor: pointer; }
.top-header-user img { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; display: block; }
.top-header-user-placeholder { width: 30px; height: 30px; border-radius: 50%; background: var(--text-muted); display: flex; align-items: center; justify-content: center; color: var(--bg); font-size: 0.75rem; font-weight: 700; }
.top-header-dropdown { display: none; position: absolute; top: 100%; right: 0; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); min-width: 180px; z-index: 50; }
.top-header-dropdown::before { content: ''; position: absolute; top: -8px; left: 0; right: 0; height: 8px; }
.top-header-user:hover .top-header-dropdown { display: block; }
.top-header-dropdown a { display: block; padding: 0.6rem 1rem; font-size: 0.85rem; color: var(--text-secondary) !important; text-decoration: none; font-weight: 500; }
.top-header-dropdown a:hover { background: var(--bg-secondary); }
.top-header-dropdown .signout-link { color: #d32f2f !important; border-top: 1px solid var(--border); }
@media (max-width: 768px) { .top-header-search { display: none; } }
@media (prefers-color-scheme: dark) { .top-header-dropdown { box-shadow: 0 4px 16px rgba(0,0,0,0.4); } }
`;

// ─── Left Nav Styles ────────────────────────────────────────────────────────

export const NAV_STYLES = `
.app-shell { display: flex; min-height: 100vh; max-width: 1280px; margin: 0 auto; }
.left-nav { width: 220px; flex-shrink: 0; padding: 1.5rem 1rem; display: flex; flex-direction: column; position: sticky; top: var(--header-height); height: calc(100vh - var(--header-height)); gap: 0.5rem; }
.nav-items { display: flex; flex-direction: column; gap: 0.25rem; flex: 1; }
.nav-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.65rem 0.85rem; border-radius: 10px; color: var(--text-secondary); text-decoration: none; font-size: 0.9rem; font-weight: 500; transition: all 0.15s; }
.nav-item:hover { background: var(--bg-secondary); color: var(--text-main); }
.nav-item.active { background: var(--bg-secondary); color: var(--text-main); font-weight: 600; }
.nav-item svg { width: 20px; height: 20px; flex-shrink: 0; }
.nav-footer { padding-top: 1.5rem; padding-bottom: 0.5rem; border-top: 1px solid var(--border); }
.nav-write-btn { display: flex; align-items: center; justify-content: center; gap: 0.5rem; width: 100%; padding: 0.6rem 1rem; background: var(--accent); color: var(--bg); border: none; border-radius: 99px; font-size: 0.875rem; font-weight: 600; font-family: var(--font-sans); cursor: pointer; text-decoration: none; transition: background 0.15s; }
.nav-write-btn:hover { background: var(--accent-hover); }
.right-sidebar { width: 280px; flex-shrink: 0; padding: 1.5rem; position: sticky; top: var(--header-height); height: calc(100vh - var(--header-height)); overflow-y: auto; }
.sidebar-section { margin-bottom: 2rem; }
.sidebar-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 0.75rem; }
@media (max-width: 1024px) { .right-sidebar { display: none; } }
@media (max-width: 768px) { .left-nav { display: none; } .center-content { border: none; } }
`;

// ─── Font Links ─────────────────────────────────────────────────────────────

export function FontLinks() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:ital,wght@0,300;0,400;0,700;1,300;1,400&display=swap" rel="stylesheet" />
      <link rel="alternate" type="application/atom+xml" title="Centipedia Feed" href="/feed.xml" />
    </>
  );
}

// ─── Header Component ───────────────────────────────────────────────────────

export function TopHeader({ profile }: { profile?: UserProfile | null }) {
  return (
    <header class="top-header">
      <a href="/" class="top-header-logo">
        <img src="/logo.jpg" alt="Centipedia" onerror="this.outerHTML='<span>Centipedia</span>'" />
      </a>
      <form class="top-header-search" action="/search" method="get">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input type="text" name="q" placeholder="Search articles..." />
      </form>
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
              <a href="/my-citations">My Citations</a>
              <a href="/logout" class="signout-link">Sign out</a>
            </div>
          </div>
        ) : (
          <a href="/login" class="top-header-signin">Sign In</a>
        )}
      </div>
    </header>
  );
}

// ─── Left Nav Component ─────────────────────────────────────────────────────

export function LeftNav({ active, profile }: { active: string; profile?: UserProfile | null }) {
  return (
    <nav class="left-nav">
      <div class="nav-items">
        <a href="/" class={`nav-item ${active === 'home' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          Home
        </a>
        <a href="/topics" class={`nav-item ${active === 'topics' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
          </svg>
          Topics
        </a>
        <a href="/submit" class={`nav-item ${active === 'submit' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Submit Citation
        </a>
        <a href="/search" class={`nav-item ${active === 'search' ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          Search
        </a>
        {profile && (
          <a href="/my-citations" class={`nav-item ${active === 'my-citations' ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
            </svg>
            My Citations
          </a>
        )}
      </div>
      <div class="nav-footer">
        {profile ? (
          <a href="/submit" class="nav-write-btn">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Submit
          </a>
        ) : (
          <a href="/login" class="nav-write-btn">Sign In</a>
        )}
      </div>
    </nav>
  );
}

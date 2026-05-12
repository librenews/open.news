export const TopHeaderStyles = `
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
    gap: 0.5rem;
  }
  .top-header-logo img {
    height: 44px;
    width: auto;
  }
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
  .top-header-search input::placeholder {
    color: var(--text-muted);
  }
  @media (max-width: 768px) {
    .top-header-search { display: none; }
  }
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
  .top-header-links a:hover {
    color: var(--text-main);
  }
  .top-header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .top-header-write {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    color: var(--text-secondary);
    text-decoration: none;
    transition: background 0.15s, color 0.15s;
  }
  .top-header-write:hover {
    background: var(--bg-secondary);
    color: var(--text-main);
  }
  .top-header-signin {
    padding: 0.4rem 1rem;
    background: var(--accent);
    color: var(--bg);
    border: none;
    border-radius: 99px;
    font-size: 0.8rem;
    font-weight: 600;
    font-family: var(--font-sans);
    text-decoration: none;
    transition: background 0.15s;
  }
  .top-header-signin:hover {
    opacity: 0.85;
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
  .top-header-user:hover .top-header-dropdown {
    display: block;
  }
  .top-header-dropdown a {
    display: block;
    padding: 0.6rem 1rem;
    font-size: 0.85rem;
    color: var(--text-secondary) !important;
    text-decoration: none;
    font-weight: 500;
  }
  .top-header-dropdown a:hover {
    background: var(--bg-secondary);
  }
  .top-header-dropdown .signout-link {
    color: #d32f2f !important;
    border-top: 1px solid var(--border);
  }
  @media (prefers-color-scheme: dark) {
    .top-header-dropdown {
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }
  }
`;

export function TopHeader({ profile }: { profile: any }) {
  return (
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
      <div class="top-header-right">
        {profile ? (
          <>
            <a href="/new" class="top-header-write" title="Write">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </a>
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
                <a href="/posts">My Stories</a>
                <a href="/new">New Draft</a>
                <a href="/logout" class="signout-link">Sign out</a>
              </div>
            </div>
          </>
        ) : (
          <a href="/login" class="top-header-signin">Sign In</a>
        )}
      </div>
    </header>
  );
}

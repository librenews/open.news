/** @jsxImportSource hono/jsx */
import { BASE_STYLES, HEADER_STYLES, NAV_STYLES, FontLinks, TopHeader, LeftNav } from './partials.js';
import type { UserProfile } from './partials.js';

export interface ProfileData {
  did: string;
  handle: string;
  displayName: string;
  avatar: string;
  description: string;
  followersCount: number;
  followsCount: number;
}

export interface ProfileStory {
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

export interface ProfileCitation {
  id: number;
  url: string;
  title: string | null;
  topic: string | null;
  status: string;
  endorsements: number;
  article_rkey: string | null;
  created_at: string;
}

export interface TrustStats {
  citationsSubmitted: number;
  citationsAccepted: number;
  endorsementsReceived: number;
  endorsementsGiven: number;
  trustedDomains: string[];
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
.center-content { flex: 1; min-width: 0; padding: 2rem 1.75rem; border-left: 1px solid var(--border); }
.profile-header { display: flex; gap: 1.5rem; margin-bottom: 2.5rem; padding-bottom: 2rem; border-bottom: 1px solid var(--border); }
.profile-avatar { width: 80px; height: 80px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.profile-avatar-placeholder { width: 80px; height: 80px; border-radius: 50%; background: var(--text-muted); display: flex; align-items: center; justify-content: center; color: var(--bg); font-size: 2rem; font-weight: 700; flex-shrink: 0; }
.profile-info { flex: 1; min-width: 0; }
.profile-name { font-family: var(--font-sans); font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 0.25rem; }
.profile-handle { font-size: 0.9rem; color: var(--text-muted); margin-bottom: 0.75rem; }
.profile-handle a { color: var(--text-muted); text-decoration: none; }
.profile-handle a:hover { color: var(--text-secondary); text-decoration: underline; }
.profile-bio { font-size: 0.9rem; line-height: 1.6; color: var(--text-secondary); margin-bottom: 0.75rem; }
.profile-stats { display: flex; gap: 1.25rem; font-size: 0.85rem; color: var(--text-muted); }
.profile-stats strong { color: var(--text-main); font-weight: 600; }
.profile-stories-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 1rem; }
.story-item { padding: 1.25rem 0; border-bottom: 1px solid var(--border); display: flex; gap: 1.25rem; align-items: flex-start; }
.story-item:first-child { padding-top: 0; }
.story-item-content { flex: 1; min-width: 0; }
.story-item a { text-decoration: none; color: inherit; }
.story-item-title { font-family: var(--font-body); font-size: 1.1rem; font-weight: 700; line-height: 1.4; margin-bottom: 0.35rem; transition: color 0.15s; }
.story-item a:hover .story-item-title { color: var(--text-secondary); }
.story-item-meta { font-size: 0.8rem; color: var(--text-muted); display: flex; gap: 0.5rem; align-items: center; }
.story-item-excerpt { font-family: var(--font-body); font-size: 0.85rem; font-weight: 300; line-height: 1.6; color: var(--text-secondary); margin-bottom: 0.5rem; }
.story-item-thumb { flex-shrink: 0; width: 100px; height: 68px; border-radius: 6px; overflow: hidden; }
.story-item-thumb img { width: 100%; height: 100%; object-fit: cover; }
.empty-profile { text-align: center; padding: 3rem 2rem; color: var(--text-muted); }
.empty-profile h3 { font-family: var(--font-body); font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 0.5rem; }
.profile-follow-btn { display: inline-flex; align-items: center; gap: 0.4rem; margin-top: 1rem; padding: 0.45rem 1.25rem; border: 1px solid var(--border); border-radius: 99px; background: transparent; color: var(--text-secondary); font-size: 0.85rem; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.profile-follow-btn:hover { background: var(--bg-secondary); color: var(--text-main); border-color: var(--text-muted); }
.profile-follow-btn.following { background: var(--accent); color: var(--bg); border-color: var(--accent); }
.profile-follow-btn.following:hover { background: #d32f2f; border-color: #d32f2f; }
.profile-endorse-btn { display: inline-flex; align-items: center; gap: 0.4rem; margin-top: 1rem; margin-left: 0.5rem; padding: 0.45rem 1.25rem; border: 1px solid #10b981; border-radius: 99px; background: transparent; color: #10b981; font-size: 0.85rem; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.profile-endorse-btn:hover { background: rgba(16,185,129,0.08); }
.profile-endorse-btn.endorsed { background: #10b981; color: #fff; }
.profile-endorse-btn.endorsed:hover { background: #ef4444; border-color: #ef4444; }

/* Trust stats */
.trust-section { margin-top: 2rem; padding-top: 2rem; border-top: 1px solid var(--border); }
.trust-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
@media (max-width: 640px) { .trust-grid { grid-template-columns: repeat(2, 1fr); } }
.trust-card { padding: 1rem; border: 1px solid var(--border); border-radius: 10px; text-align: center; }
.trust-card-value { font-size: 1.5rem; font-weight: 800; font-family: var(--font-sans); letter-spacing: -0.02em; }
.trust-card-label { font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 0.15rem; }

/* Contributions list */
.contrib-item { display: flex; gap: 0.75rem; padding: 0.75rem 0; border-bottom: 1px solid var(--border); align-items: flex-start; }
.contrib-status { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; padding: 0.15rem 0.45rem; border-radius: 99px; flex-shrink: 0; margin-top: 0.1rem; }
.contrib-status[data-status="accepted"] { background: rgba(16,185,129,0.1); color: #10b981; }
.contrib-status[data-status="pending"] { background: rgba(245,158,11,0.1); color: #f59e0b; }
.contrib-status[data-status="rejected"] { background: rgba(239,68,68,0.1); color: #ef4444; }
.contrib-body { flex: 1; min-width: 0; }
.contrib-title { font-size: 0.85rem; font-weight: 600; color: var(--accent); text-decoration: none; word-break: break-word; }
.contrib-title:hover { text-decoration: underline; }
.contrib-meta { font-size: 0.7rem; color: var(--text-muted); margin-top: 0.2rem; font-family: var(--font-sans); display: flex; gap: 0.5rem; }
.contrib-endorsements { color: #10b981; font-weight: 600; display: flex; align-items: center; gap: 0.2rem; }

/* Domains */
.trusted-domains { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.5rem; }
.domain-badge { padding: 0.25rem 0.6rem; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 99px; font-size: 0.75rem; color: var(--text-secondary); font-family: var(--font-sans); }

.tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 1.5rem; }
.tab { padding: 0.6rem 1.25rem; font-size: 0.85rem; font-weight: 500; color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; transition: all 0.15s; background: none; border-top: none; border-left: none; border-right: none; font-family: var(--font-sans); }
.tab:hover { color: var(--text-secondary); }
.tab.active { color: var(--text-main); border-bottom-color: var(--accent); font-weight: 600; }
.tab-content { display: none; }
.tab-content.active { display: block; }

@media (max-width: 640px) { .profile-header { flex-direction: column; align-items: center; text-align: center; } .profile-stats { justify-content: center; } }
`;

export function ProfilePage({
  author, stories, sessionProfile, domain,
  citations = [], trustStats, isEndorsed = false,
}: {
  author: ProfileData;
  stories: ProfileStory[];
  sessionProfile?: UserProfile | null;
  domain: string;
  citations?: ProfileCitation[];
  trustStats?: TrustStats;
  isEndorsed?: boolean;
}) {
  const publicationUri = stories.find(s => s.publicationUri)?.publicationUri || null;
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{author.displayName} — Centipedia</title>
        <meta name="description" content={author.description || `${author.displayName}'s contributions on Centipedia.`} />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <FontLinks />
        <style dangerouslySetInnerHTML={{__html: BASE_STYLES + HEADER_STYLES + NAV_STYLES + PAGE_STYLES}} />
      </head>
      <body>
        <TopHeader profile={sessionProfile} />

        <div class="app-shell">
          <LeftNav active="" profile={sessionProfile} />

          <main class="center-content">
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
                  <span><strong>{stories.length}</strong> {stories.length === 1 ? 'article' : 'articles'}</span>
                </div>
                {publicationUri && sessionProfile && (
                  <button class="profile-follow-btn" id="profile-follow-btn" data-publication={publicationUri}>
                    Follow
                  </button>
                )}
                {sessionProfile && sessionProfile.handle !== author.handle && (
                  <button class={`profile-endorse-btn ${isEndorsed ? 'endorsed' : ''}`} id="endorse-user-btn" data-did={author.did}>
                    {isEndorsed ? '✓ Endorsed' : '↑ Endorse'}
                  </button>
                )}
              </div>
            </div>

            {/* Trust stats */}
            {trustStats && (
              <div class="trust-section">
                <h2 class="profile-stories-title">Trust Profile</h2>
                <div class="trust-grid">
                  <div class="trust-card">
                    <div class="trust-card-value">{trustStats.citationsSubmitted}</div>
                    <div class="trust-card-label">Citations</div>
                  </div>
                  <div class="trust-card">
                    <div class="trust-card-value">{trustStats.citationsAccepted}</div>
                    <div class="trust-card-label">Accepted</div>
                  </div>
                  <div class="trust-card">
                    <div class="trust-card-value">{trustStats.endorsementsReceived}</div>
                    <div class="trust-card-label">Endorsements</div>
                  </div>
                  <div class="trust-card">
                    <div class="trust-card-value">{trustStats.endorsementsGiven}</div>
                    <div class="trust-card-label">Given</div>
                  </div>
                </div>
                {trustStats.trustedDomains.length > 0 && (
                  <div>
                    <div class="profile-stories-title">Trusted Sources</div>
                    <div class="trusted-domains">
                      {trustStats.trustedDomains.map(d => <span class="domain-badge">{d}</span>)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tabs */}
            <div class="tabs" id="profile-tabs">
              <button class="tab active" data-tab="articles">Articles ({stories.length})</button>
              <button class="tab" data-tab="citations">Citations ({citations.length})</button>
            </div>

            {/* Articles tab */}
            <div class="tab-content active" id="tab-articles">
            {stories.length === 0 ? (
              <div class="empty-profile">
                <h3>No articles yet</h3>
                <p>{author.displayName} hasn't published any articles on Centipedia.</p>
              </div>
            ) : (
              stories.map((s) => {
                const rkey = s.uri.split('/').pop();
                const readUrl = s.externalUrl || `https://${domain}/post/${s.authorDid}/${rkey}`;
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

            {/* Citations tab */}
            <div class="tab-content" id="tab-citations">
              {citations.length === 0 ? (
                <div class="empty-profile">
                  <h3>No citations</h3>
                  <p>{author.displayName} hasn't submitted any citations yet.</p>
                </div>
              ) : (
                citations.map(c => (
                  <div class="contrib-item">
                    <div class="contrib-status" data-status={c.status}>{c.status}</div>
                    <div class="contrib-body">
                      <a href={c.url} target="_blank" rel="noopener" class="contrib-title">{c.title || c.url}</a>
                      <div class="contrib-meta">
                        {c.topic && <span>{c.topic}</span>}
                        <span>{timeAgo(c.created_at)}</span>
                        {c.endorsements > 0 && (
                          <span class="contrib-endorsements">
                            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                            {c.endorsements}
                          </span>
                        )}
                        {c.article_rkey && (
                          <a href={`/post/did:plc:srdudtvbpm5ck3i4mjdoasdy/${c.article_rkey}`} style="color: var(--accent); text-decoration: none; font-weight: 600;">→ Article</a>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </main>
        </div>
        <script dangerouslySetInnerHTML={{__html: `
          (async function() {
            const btn = document.getElementById('profile-follow-btn');
            if (!btn) return;
            const pub = btn.dataset.publication;
            try {
              const res = await fetch('/api/subscription-status?publication=' + encodeURIComponent(pub));
              const data = await res.json();
              if (data.subscribed) { btn.classList.add('following'); btn.textContent = 'Following'; btn.dataset.rkey = data.rkey; }
            } catch(e) {}
            btn.addEventListener('click', async () => {
              btn.disabled = true;
              if (btn.classList.contains('following')) {
                try { const res = await fetch('/api/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rkey: btn.dataset.rkey }) }); if (res.ok) { btn.classList.remove('following'); btn.textContent = 'Follow'; } } catch(e) {}
              } else {
                try { const res = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publication: pub }) }); const data = await res.json(); if (data.ok) { btn.classList.add('following'); btn.textContent = 'Following'; btn.dataset.rkey = data.rkey; } } catch(e) {}
              }
              btn.disabled = false;
            });
          })();

          // Tab switching
          document.querySelectorAll('#profile-tabs .tab').forEach(tab => {
            tab.addEventListener('click', () => {
              document.querySelectorAll('#profile-tabs .tab').forEach(t => t.classList.remove('active'));
              document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
              tab.classList.add('active');
              document.getElementById('tab-' + tab.dataset.tab)?.classList.add('active');
            });
          });

          // Endorse user button
          const endorseBtn = document.getElementById('endorse-user-btn');
          if (endorseBtn) {
            endorseBtn.addEventListener('click', async () => {
              endorseBtn.disabled = true;
              try {
                const res = await fetch('/api/endorse/submitter', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ subjectDid: endorseBtn.dataset.did })
                });
                if (res.status === 401) { location.href = '/login'; return; }
                const data = await res.json();
                if (res.ok) {
                  endorseBtn.classList.toggle('endorsed', data.endorsed);
                  endorseBtn.textContent = data.endorsed ? '✓ Endorsed' : '↑ Endorse';
                }
              } catch(e) {}
              endorseBtn.disabled = false;
            });
          }
        `}} />
      </body>
    </html>
  );
}

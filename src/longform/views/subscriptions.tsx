import { html } from 'hono/html';

interface SubscriptionItem {
  rkey: string;
  publicationUri: string;
  publicationTitle: string | null;
  publicationUrl: string | null;
  authorDid: string;
  authorHandle: string;
  authorAvatar: string;
  authorName: string;
  createdAt: string | null;
}

interface SubscriptionsPageProps {
  subscriptions: SubscriptionItem[];
  domain: string;
  profile: { displayName: string; avatar: string; handle: string } | null;
}

export function SubscriptionsPage({ subscriptions, domain, profile }: SubscriptionsPageProps) {
  return html`
    <style>
      .subs-container {
        max-width: 680px;
        margin: 0 auto;
        padding: 2rem 1rem;
      }
      .subs-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 2rem;
      }
      .subs-header h1 {
        font-family: var(--font-sans);
        font-weight: 700;
        letter-spacing: -0.03em;
        margin: 0;
        font-size: 28px;
      }
      .subs-count {
        font-family: var(--font-sans);
        font-size: 14px;
        color: var(--text-muted);
      }
      .sub-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 0;
        border-bottom: 1px solid rgba(0,0,0,0.06);
        transition: opacity 0.15s;
      }
      .sub-card:hover { opacity: 0.8; }
      .sub-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
        flex: 1;
        text-decoration: none;
        color: inherit;
      }
      .sub-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
        background: rgba(0,0,0,0.05);
      }
      .sub-info {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        min-width: 0;
      }
      .sub-pub-title {
        font-family: var(--font-sans);
        font-weight: 600;
        font-size: 16px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sub-author {
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sub-meta {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-shrink: 0;
        margin-left: 1rem;
      }
      .sub-uri {
        font-family: var(--font-mono, monospace);
        font-size: 11px;
        color: var(--text-muted);
        max-width: 200px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sub-unfollow-btn {
        background: none;
        border: 1px solid rgba(0,0,0,0.15);
        padding: 0.3rem 0.7rem;
        border-radius: 99px;
        cursor: pointer;
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 500;
        color: var(--text-muted);
        transition: all 0.15s;
      }
      .sub-unfollow-btn:hover {
        border-color: #f02050;
        color: #f02050;
      }
      .sub-empty {
        text-align: center;
        padding: 4rem 2rem;
        color: var(--text-muted);
        font-family: var(--font-sans);
      }
      .sub-empty p { margin: 0.5rem 0; font-size: 16px; }
      .sub-empty a { color: var(--accent, #118156); text-decoration: none; }
      .sub-empty a:hover { text-decoration: underline; }
      @media (prefers-color-scheme: dark) {
        .sub-card { border-bottom-color: rgba(255,255,255,0.06); }
        .sub-unfollow-btn { border-color: rgba(255,255,255,0.15); }
        .sub-avatar { background: rgba(255,255,255,0.1); }
      }
    </style>

    <div class="subs-container">
      <div class="subs-header">
        <h1>Subscriptions</h1>
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span class="subs-count">${subscriptions.length} publication${subscriptions.length !== 1 ? 's' : ''}</span>
          <a href="/feed/following.xml" title="RSS feed — Following" style="display: flex; align-items: center; color: var(--text-muted); transition: color 0.15s;" onmouseover="this.style.color='#f26522'" onmouseout="this.style.color='var(--text-muted)'">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19 7.38 20 6.18 20C5 20 4 19 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z"/></svg>
          </a>
        </div>
      </div>

      ${subscriptions.length === 0 ? html`
        <div class="sub-empty">
          <div style="font-size: 48px; margin-bottom: 1rem;">📚</div>
          <p><strong>No subscriptions yet</strong></p>
          <p>Follow publications from article pages to see them here.</p>
          <p style="margin-top: 1rem;"><a href="/">← Browse articles</a></p>
        </div>
      ` : ''}

      ${subscriptions.map(sub => html`
        <div class="sub-card" data-rkey="${sub.rkey}">
          <a href="${sub.publicationUri.startsWith('at://') ? '/publication/' + sub.publicationUri.replace('at://', '').split('/')[0] + '/' + sub.publicationUri.split('/').pop() : '#'}" class="sub-left">
            <img class="sub-avatar" src="${sub.authorAvatar || '/static/default-avatar.png'}" alt="" loading="lazy" />
            <div class="sub-info">
              <span class="sub-pub-title">${sub.publicationTitle || sub.publicationUri}</span>
              <span class="sub-author">by ${sub.authorName || sub.authorHandle || sub.authorDid}</span>
            </div>
          </a>
          <div class="sub-meta">
            <span class="sub-uri" title="${sub.publicationUri}">${sub.publicationUri}</span>
            <button class="sub-unfollow-btn" onclick="unfollowSub('${sub.rkey}', this)">Unfollow</button>
          </div>
        </div>
      `)}
    </div>

    <script>
      async function unfollowSub(rkey, btn) {
        if (!confirm('Unfollow this publication?')) return;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          const res = await fetch('/api/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rkey: rkey })
          });
          if (res.ok) {
            var card = btn.closest('.sub-card');
            card.style.opacity = '0';
            card.style.transition = 'opacity 0.3s, height 0.3s, padding 0.3s, margin 0.3s';
            card.style.height = '0';
            card.style.padding = '0';
            card.style.overflow = 'hidden';
            setTimeout(function() { card.remove(); }, 300);
            // Update count
            var countEl = document.querySelector('.subs-count');
            var remaining = document.querySelectorAll('.sub-card').length - 1;
            if (countEl) countEl.textContent = remaining + ' publication' + (remaining !== 1 ? 's' : '');
          } else {
            alert('Failed to unfollow');
            btn.disabled = false;
            btn.textContent = 'Unfollow';
          }
        } catch(e) {
          alert('Failed to unfollow');
          btn.disabled = false;
          btn.textContent = 'Unfollow';
        }
      }
    </script>
  `;
}

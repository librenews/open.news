import { html } from 'hono/html';

interface DraftItem {
  documentName: string;
  title: string;
  status: 'draft' | 'published';
  date: string;
  rkey: string;
  did: string;
}

interface SharedItem {
  documentName: string;
  title: string;
  permission: string;
  ownerHandle: string;
  date: string;
}

export function PostsPage(
  items: DraftItem[],
  sharedItems: SharedItem[],
  sessionDid: string
) {
  return html`
    <div style="margin-top: 2rem;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
        <h1 style="font-family: var(--font-sans); letter-spacing: -0.03em; margin: 0;">My Work</h1>
        <button onclick="window.createNewDraft()" id="new-draft-btn" style="background: #118156; color: white; border: none; padding: 0.5rem 1.2rem; border-radius: 99px; cursor: pointer; font-family: var(--font-sans); font-weight: 500; font-size: 14px;">+ New Draft</button>
      </div>

      <!-- Tabs -->
      <div style="display: flex; gap: 0; border-bottom: 1px solid rgba(0,0,0,0.1); margin-bottom: 2rem; font-family: var(--font-sans);">
        <button class="tab-btn active" data-tab="mine" onclick="switchTab('mine')" style="background: none; border: none; border-bottom: 2px solid #242424; padding: 0.75rem 1.5rem; cursor: pointer; font-weight: 600; font-size: 14px; color: var(--text-main);">My Work</button>
        <button class="tab-btn" data-tab="shared" onclick="switchTab('shared')" style="background: none; border: none; border-bottom: 2px solid transparent; padding: 0.75rem 1.5rem; cursor: pointer; font-weight: 500; font-size: 14px; color: var(--text-muted);">Shared with me</button>
      </div>

      <!-- My Work Tab -->
      <div id="tab-mine">
        <!-- Filters -->
        <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem;">
          <button class="filter-btn active" data-filter="all" onclick="filterItems('all')" style="background: #242424; color: white; border: none; padding: 0.35rem 0.9rem; border-radius: 99px; cursor: pointer; font-family: var(--font-sans); font-size: 13px; font-weight: 500;">All</button>
          <button class="filter-btn" data-filter="draft" onclick="filterItems('draft')" style="background: rgba(0,0,0,0.06); color: var(--text-main); border: none; padding: 0.35rem 0.9rem; border-radius: 99px; cursor: pointer; font-family: var(--font-sans); font-size: 13px; font-weight: 500;">Drafts</button>
          <button class="filter-btn" data-filter="published" onclick="filterItems('published')" style="background: rgba(0,0,0,0.06); color: var(--text-main); border: none; padding: 0.35rem 0.9rem; border-radius: 99px; cursor: pointer; font-family: var(--font-sans); font-size: 13px; font-weight: 500;">Published</button>
        </div>

        <div id="items-list" style="display: flex; flex-direction: column; gap: 0; min-height: 120px;">
          ${items.length === 0 ? html`<p style="color: var(--text-muted); font-family: var(--font-sans); text-align: center; padding: 3rem 0; margin: 0;">No posts yet. Click <strong>+ New Draft</strong> to get started.</p>` : ''}
          ${items.map(item => html`
            <div data-status="${item.status}" class="post-item" style="display: flex; align-items: center; justify-content: space-between; padding: 1rem 0; border-bottom: 1px solid rgba(0,0,0,0.06);">
              <a href="${item.status === 'draft' ? '/?doc=' + encodeURIComponent(item.documentName) : '/post/' + item.did + '/' + item.rkey}" style="text-decoration: none; color: inherit; display: flex; align-items: center; justify-content: space-between; flex: 1; min-width: 0; transition: opacity 0.15s;" onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'">
                <div style="display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; flex: 1;">
                  <span style="font-family: var(--font-sans); font-weight: 600; font-size: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.title}</span>
                  <span style="color: var(--text-muted); font-size: 13px; font-family: var(--font-sans);">${item.date}</span>
                </div>
                <span style="font-family: var(--font-sans); font-size: 12px; font-weight: 500; padding: 0.2rem 0.6rem; border-radius: 99px; white-space: nowrap; margin-left: 1rem; ${item.status === 'draft' ? 'background: #fff3cd; color: #856404;' : 'background: #d4edda; color: #155724;'}">${item.status === 'draft' ? 'Draft' : 'Published'}</span>
              </a>
              <a href="${item.status === 'published' ? '/edit/' + item.rkey : '/?doc=' + encodeURIComponent(item.documentName)}" title="Edit" style="background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 0.5rem; margin-left: 0.25rem; transition: color 0.15s; display: flex; align-items: center; text-decoration: none;" onmouseover="this.style.color='var(--accent, #118156)'" onmouseout="this.style.color='var(--text-muted)'">
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </a>
              <button onclick="deletePost('${item.documentName.replace(/'/g, "\\\\'")}', '${item.rkey}', '${item.status}')" title="Delete" style="background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 0.5rem; margin-left: 0.25rem; transition: color 0.15s; display: flex; align-items: center;" onmouseover="this.style.color='#f02050'" onmouseout="this.style.color='var(--text-muted)'">
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>
          `)}
        </div>
      </div>

      <!-- Shared with me Tab -->
      <div id="tab-shared" style="display: none; min-height: 120px;">
        <div style="display: flex; flex-direction: column; gap: 0;">
          ${sharedItems.length === 0 ? html`<p style="color: var(--text-muted); font-family: var(--font-sans); text-align: center; padding: 3rem 0; margin: 0;">No documents have been shared with you yet.</p>` : ''}
          ${sharedItems.map(item => html`
            <a href="/?doc=${encodeURIComponent(item.documentName)}" class="post-item" style="text-decoration: none; color: inherit; display: flex; align-items: center; justify-content: space-between; padding: 1rem 0; border-bottom: 1px solid rgba(0,0,0,0.06); transition: opacity 0.15s;" onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'">
              <div style="display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; flex: 1;">
                <span style="font-family: var(--font-sans); font-weight: 600; font-size: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.title}</span>
                <span style="color: var(--text-muted); font-size: 13px; font-family: var(--font-sans);">by ${item.ownerHandle} · ${item.permission === 'write' ? 'Can Edit' : 'View Only'}</span>
              </div>
            </a>
          `)}
        </div>
      </div>
    </div>

    <script>
      function switchTab(tab) {
        document.getElementById('tab-mine').style.display = tab === 'mine' ? 'block' : 'none';
        document.getElementById('tab-shared').style.display = tab === 'shared' ? 'block' : 'none';
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
          var isActive = btn.getAttribute('data-tab') === tab;
          btn.style.borderBottomColor = isActive ? '#242424' : 'transparent';
          btn.style.fontWeight = isActive ? '600' : '500';
          btn.style.color = isActive ? 'var(--text-main)' : 'var(--text-muted)';
        });
      }

      function filterItems(filter) {
        document.querySelectorAll('.filter-btn').forEach(function(btn) {
          var isActive = btn.getAttribute('data-filter') === filter;
          btn.style.background = isActive ? '#242424' : 'rgba(0,0,0,0.06)';
          btn.style.color = isActive ? 'white' : 'var(--text-main)';
        });
        document.querySelectorAll('#items-list .post-item').forEach(function(item) {
          if (filter === 'all') {
            item.style.display = 'flex';
          } else {
            item.style.display = item.getAttribute('data-status') === filter ? 'flex' : 'none';
          }
        });
      }

      window.createNewDraft = async function() {
        var btn = document.getElementById('new-draft-btn');
        btn.disabled = true;
        btn.innerText = 'Creating...';
        try {
          var res = await fetch('/api/drafts', { method: 'POST' });
          var data = await res.json();
          if (data.docId) {
            window.location.href = '/?doc=' + encodeURIComponent(data.docId);
          } else {
            alert(data.error || 'Failed to create draft');
          }
        } catch (e) {
          alert('Failed to create draft');
        }
        btn.disabled = false;
        btn.innerText = '+ New Draft';
      };

      async function deletePost(docId, rkey, status) {
        var label = status === 'draft' ? 'draft' : 'published post';
        if (!confirm('Are you sure you want to delete this ' + label + '? This cannot be undone.')) return;

        try {
          var res = await fetch('/api/drafts', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docId: docId, rkey: rkey })
          });
          var data = await res.json();
          if (data.success) {
            window.location.reload();
          } else {
            alert('Failed to delete: ' + (data.error || 'Unknown error'));
          }
        } catch (e) {
          alert('Failed to delete');
        }
      }
    </script>

    <style>
      @media (prefers-color-scheme: dark) {
        .filter-btn { background: rgba(255,255,255,0.1) !important; }
        .filter-btn.active, .filter-btn[style*="background: #242424"] { background: #e0e0e0 !important; color: #121212 !important; }
        .tab-btn { border-bottom-color: transparent !important; }
        .tab-btn.active, .tab-btn[style*="border-bottom: 2px solid #242424"] { border-bottom-color: white !important; }
      }
    </style>
  `;
}

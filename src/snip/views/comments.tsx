import { html } from 'hono/html';
import { renderVideoCard, type VideoItem } from './feed.js';

export function renderCommentNode(node: any, depth = 0): any {
  if (!node || node.$type !== 'app.bsky.feed.defs#threadViewPost') return '';
  const post = node.post;
  const author = post.author;
  const record = post.record;
  const text = record?.text ?? '';
  const avatar = author?.avatar;
  const dateStr = record?.createdAt
    ? new Date(record.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Process replies
  let repliesHtml = '';
  if (node.replies && Array.isArray(node.replies)) {
    repliesHtml = node.replies
      .map((reply: any) => renderCommentNode(reply, depth + 1))
      .join('');
  }

  return html`
    <div class="border-l-2 border-slate-800/60 pl-4 py-2 mt-3 ml-2">
      <div class="flex items-start gap-2.5">
        <!-- Avatar -->
        ${avatar ? html`
          <img src="${avatar}" class="w-6 h-6 rounded-full shrink-0 border border-slate-800" />
        ` : html`
          <div class="w-6 h-6 rounded-full bg-slate-800 shrink-0 flex items-center justify-center text-[10px] font-bold text-slate-500">?</div>
        `}
        
        <!-- Comment Content -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs font-bold text-slate-300">${escapeHtml(author.displayName || author.handle)}</span>
            <span class="text-[10px] text-slate-500">@${escapeHtml(author.handle)}</span>
            <span class="text-[9px] text-slate-600">· ${dateStr}</span>
          </div>
          <p class="text-xs text-slate-350 leading-relaxed break-words">${escapeHtml(text)}</p>
        </div>
      </div>
      <!-- Replies -->
      ${repliesHtml ? html`<div class="mt-2">${repliesHtml}</div>` : ''}
    </div>
  `;
}

export function CommentsPage({
  item,
  thread,
  related
}: {
  item: VideoItem;
  thread: any;
  related: VideoItem[];
}) {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return html`
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      <!-- Main Content & Comments (8 cols wide on desktop) -->
      <div class="lg:col-span-8 space-y-6">
        <!-- Main Video Card -->
        <div class="bg-slate-900/10 border border-slate-850 rounded-3xl p-6 shadow-xl">
          <div class="flex items-center justify-between mb-4 text-xs text-slate-500">
            <a href="/" class="text-indigo-400 hover:text-indigo-300 transition-colors no-underline">← Back to Home</a>
            <span>ID: ${item.id}</span>
          </div>
          ${renderVideoCard(item, true)}
        </div>

        <!-- Comments Header -->
        <div class="bg-slate-900/20 border border-slate-800/40 rounded-3xl p-6 shadow-md">
          <h3 class="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 select-none">💬 Discussion</h3>
          
          <div class="mt-4">
            ${thread ? renderCommentNode(thread) : html`
              <p class="text-xs text-slate-500 text-center py-6 select-none">No comments on this post yet, or comments are restricted.</p>
            `}
          </div>
        </div>
      </div>

      <!-- Related Videos Sidebar (4 cols wide on desktop) -->
      <div class="lg:col-span-4 space-y-6">
        <div class="bg-slate-900/20 border border-slate-800/40 rounded-3xl p-5">
          <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 select-none">🔊 More Like This</h3>
          
          <div class="space-y-4">
            ${related.length > 0 ? related.map(rel => {
              const relPostUrl = `/post/${encodeURIComponent(rel.uri)}`;
              const relAuthorUrl = `/profile/${encodeURIComponent(rel.did)}`;
              return html`
                <div class="bg-slate-950/40 border border-slate-850 rounded-xl p-3 hover:border-indigo-500/30 transition-all">
                  <div class="flex gap-3">
                    ${rel.thumbnail_cid && rel.did
                      ? html`<img src="${rel.thumbnail_cid.startsWith('http') ? escapeHtml(rel.thumbnail_cid) : escapeHtml(`https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(rel.did)}&cid=${encodeURIComponent(rel.thumbnail_cid)}`)}"
                              alt="" loading="lazy" class="w-20 h-20 object-cover rounded-lg bg-black shrink-0" />`
                      : html`<div class="w-20 h-20 rounded-lg bg-slate-900 shrink-0 flex items-center justify-center text-slate-600 text-xl">▶</div>`
                    }
                    <div class="min-w-0 flex-1">
                      <a href="${relPostUrl}" class="block text-xs font-bold text-slate-200 hover:text-indigo-400 transition-colors no-underline line-clamp-2 leading-relaxed mb-1">
                        ${escapeHtml(rel.post_text || rel.alt_text || 'Video clip')}
                      </a>
                      <a href="${relAuthorUrl}" class="text-[10px] text-slate-500 hover:text-indigo-400 transition-colors no-underline">
                        @${escapeHtml(rel.author_handle)}
                      </a>
                    </div>
                  </div>
                </div>
              `;
            }) : html`
              <p class="text-xs text-slate-500 select-none">No related videos found.</p>
            `}
          </div>
        </div>
      </div>
    </div>
  `;
}

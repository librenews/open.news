import { html } from 'hono/html';
import { renderVideoCard, type VideoItem } from './feed.js';

export interface AuthorProfile {
  did: string;
  handle: string;
  displayName: string | null;
  description: string | null;
  avatar: string | null;
  banner: string | null;
  followersCount?: number;
  followsCount?: number;
}

export function AuthorPage({
  profile,
  items,
  stats
}: {
  profile: AuthorProfile;
  items: VideoItem[];
  stats: { video_count: number; total_likes: number; total_reposts: number };
}) {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return html`
    <div class="space-y-8 max-w-4xl mx-auto">
      <!-- Profile Header Banner -->
      <div class="relative rounded-3xl overflow-hidden bg-slate-900 border border-slate-800/80 shadow-xl">
        ${profile.banner ? html`
          <img src="${profile.banner}" class="w-full h-44 object-cover" />
        ` : html`
          <div class="w-full h-32 bg-gradient-to-r from-indigo-950 via-slate-900 to-purple-950"></div>
        `}

        <div class="px-6 pb-6 pt-0 flex flex-col md:flex-row items-start md:items-end gap-5 -mt-10 relative">
          <!-- Avatar -->
          <div class="shrink-0 relative">
            ${profile.avatar ? html`
              <img src="${profile.avatar}" class="w-24 h-24 rounded-full border-4 border-slate-950 bg-slate-900 shadow-xl" />
            ` : html`
              <div class="w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center font-bold text-3xl border-4 border-slate-950 text-slate-400 shadow-xl">?</div>
            `}
          </div>

          <!-- Name & Bio -->
          <div class="flex-1 min-w-0">
            <h1 class="title-font text-2xl font-black text-slate-100 mb-1">
              ${escapeHtml(profile.displayName || profile.handle)}
            </h1>
            <p class="text-sm text-indigo-400 font-semibold mb-2">@${escapeHtml(profile.handle)}</p>
            ${profile.description ? html`<p class="text-sm text-slate-400 leading-relaxed max-w-2xl">${escapeHtml(profile.description)}</p>` : ''}
          </div>

          <!-- Profile stats -->
          <div class="flex gap-4 text-xs font-bold text-slate-500 shrink-0 select-none">
            ${profile.followersCount !== undefined ? html`
              <span><strong class="text-slate-300 font-extrabold">${profile.followersCount}</strong> followers</span>
            ` : ''}
            ${profile.followsCount !== undefined ? html`
              <span><strong class="text-slate-300 font-extrabold">${profile.followsCount}</strong> following</span>
            ` : ''}
          </div>
        </div>

        <!-- Snip Stats Strip -->
        <div class="border-t border-slate-800/40 bg-slate-900/30 px-6 py-4 grid grid-cols-3 gap-4 text-center select-none">
          <div>
            <span class="block text-xl font-black text-slate-200">${stats.video_count}</span>
            <span class="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Clips Indexed</span>
          </div>
          <div>
            <span class="block text-xl font-black text-slate-200">${stats.total_likes}</span>
            <span class="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Likes Received</span>
          </div>
          <div>
            <span class="block text-xl font-black text-slate-200">${stats.total_reposts}</span>
            <span class="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Reposts</span>
          </div>
        </div>
      </div>

      <!-- Feed List -->
      <div class="space-y-6 max-w-2xl">
        <h2 class="text-sm font-bold text-slate-400 uppercase tracking-wider select-none">Indexed Video Clips</h2>
        <div class="space-y-4">
          ${items.length > 0 ? items.map(item => renderVideoCard(item)) : html`
            <div class="text-center py-16 bg-slate-900/10 border border-slate-800/40 rounded-3xl p-6">
              <span class="text-3xl block mb-2">📺</span>
              <p class="text-slate-400 text-sm">No videos have been transcribed for this user yet.</p>
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

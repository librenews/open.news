import { html } from 'hono/html';

export interface CreatorRow {
  did: string;
  handle: string;
  displayName: string | null;
  avatar: string | null;
  video_count: number;
  total_likes: number;
  total_reposts: number;
}

export function LeaderboardPage({ creators }: { creators: CreatorRow[] }) {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const renderRankBadge = (rank: number) => {
    if (rank === 1) return html`<span class="text-xl">🥇</span>`;
    if (rank === 2) return html`<span class="text-xl">🥈</span>`;
    if (rank === 3) return html`<span class="text-xl">🥉</span>`;
    return html`<span class="text-xs font-bold text-slate-500">#${rank}</span>`;
  };

  return html`
    <div class="max-w-3xl mx-auto space-y-6">
      <div class="text-center mb-8 select-none">
        <h1 class="title-font text-3xl font-black bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent mb-2">
          Top Video Creators
        </h1>
        <p class="text-sm text-slate-500">Creators on Bluesky ranked by total likes received on their transcribed video clips.</p>
      </div>

      <!-- Leaderboard list -->
      <div class="bg-slate-900/20 border border-slate-800/40 rounded-3xl overflow-hidden shadow-xl">
        <div class="divide-y divide-slate-900">
          <!-- Header -->
          <div class="px-6 py-4 grid grid-cols-12 gap-4 text-xs font-bold text-slate-500 uppercase tracking-wider select-none bg-slate-900/40">
            <div class="col-span-1 text-center">Rank</div>
            <div class="col-span-6">Creator</div>
            <div class="col-span-2 text-center">Clips</div>
            <div class="col-span-3 text-right">Total Likes</div>
          </div>

          <!-- Rows -->
          ${creators.length > 0 ? creators.map((creator, i) => {
            const profileUrl = `/profile/${encodeURIComponent(creator.did)}`;
            return html`
              <div class="px-6 py-4.5 grid grid-cols-12 gap-4 items-center hover:bg-slate-900/30 transition-colors">
                <!-- Rank -->
                <div class="col-span-1 flex items-center justify-center">
                  ${renderRankBadge(i + 1)}
                </div>

                <!-- Creator info -->
                <div class="col-span-6 flex items-center gap-3">
                  <a href="${profileUrl}" class="shrink-0">
                    ${creator.avatar ? html`
                      <img src="${creator.avatar}" class="w-9 h-9 rounded-full border border-slate-850" />
                    ` : html`
                      <div class="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center font-bold text-slate-400">?</div>
                    `}
                  </a>
                  <div class="min-w-0">
                    <a href="${profileUrl}" class="block text-sm font-bold text-slate-200 hover:text-indigo-400 transition-colors no-underline truncate">
                      ${escapeHtml(creator.displayName || creator.handle)}
                    </a>
                    <span class="block text-[11px] text-slate-500 truncate">@${escapeHtml(creator.handle)}</span>
                  </div>
                </div>

                <!-- Clips Count -->
                <div class="col-span-2 text-center text-sm font-semibold text-slate-400 select-none">
                  ${creator.video_count}
                </div>

                <!-- Likes count -->
                <div class="col-span-3 text-right text-sm font-bold text-slate-200 select-none">
                  ❤️ ${creator.total_likes}
                </div>
              </div>
            `;
          }) : html`
            <div class="text-center py-16 text-sm text-slate-500">
              No creators ranked yet. The database is loading...
            </div>
          `}
        </div>
      </div>
    </div>
  `;
}

import { html } from 'hono/html';
import type { PlayerSegment } from './player.js';

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  politics: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  tech: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20' },
  finance: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  news: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20' },
  science: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/20' },
};

const DEFAULT_CAT_STYLE = { bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20' };

export function ProgramGuide({ segments }: { segments: PlayerSegment[] }) {

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.round(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const timeAgo = (dateStr?: string) => {
    if (!dateStr) return '';
    const ms = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `${days}d`;
  };

  const formatCount = (n?: number) => {
    if (!n || n === 0) return '0';
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };

  return html`
    <div class="bg-slate-900/30 border border-slate-800/40 rounded-2xl overflow-hidden">
      <!-- Header -->
      <div class="px-5 py-4 border-b border-slate-800/40 flex items-center justify-between">
        <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider">Program Guide</h3>
        <span class="text-[10px] text-slate-600">${segments.filter(s => s.type === 'video').length} clips</span>
      </div>

      <!-- Segment List -->
      <div class="max-h-[600px] overflow-y-auto" style="scrollbar-width: thin; scrollbar-color: #334155 transparent;">
        ${segments.map((seg, i) => {
          if (seg.type === 'ad_break') {
            return html`
              <div class="flex items-center justify-center py-2 select-none">
                <span class="text-slate-600 text-xs tracking-[0.3em]">· · ·</span>
              </div>
            `;
          }

          const pos = seg.position;
          const catStyle = CATEGORY_COLORS[seg.storyCategory || ''] || DEFAULT_CAT_STYLE;
          const age = timeAgo(seg.createdAt);
          const likes = seg.likeCount || 0;
          const reposts = seg.repostCount || 0;
          const hasEngagement = likes > 0 || reposts > 0;

          return html`
            <div
              @click="playSegment(${pos})"
              x-bind:class="currentIndex === ${pos}
                ? 'bg-amber-400/5 border-l-2 border-l-amber-400 shadow-[inset_0_0_20px_rgba(251,191,36,0.05)]'
                : currentIndex > ${pos}
                  ? 'opacity-40 border-l-2 border-l-transparent hover:opacity-60'
                  : 'border-l-2 border-l-transparent hover:bg-slate-800/30'"
              class="px-4 py-3 cursor-pointer transition-all relative"
            >
              <div class="flex items-start gap-3">
                <!-- Author avatar -->
                <div class="flex-shrink-0 pt-0.5">
                  ${seg.authorAvatar
                    ? html`<img src="${seg.authorAvatar}" class="w-8 h-8 rounded-full object-cover ring-1 ring-slate-700/50" alt="" loading="lazy" />`
                    : html`<div class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 text-xs font-bold">${(seg.authorHandle || '?')[0].toUpperCase()}</div>`
                  }
                </div>

                <div class="flex-1 min-w-0">
                  <!-- Top row: story label + NOW/duration -->
                  <div class="flex items-start justify-between gap-2">
                    <p class="text-sm font-semibold text-slate-200 leading-snug line-clamp-2">
                      ${seg.type === 'interstitial' ? '↗ ' : ''}${seg.storyLabel || 'Untitled'}
                    </p>
                    <div class="flex flex-col items-end gap-1 shrink-0">
                      <span
                        x-show="currentIndex === ${pos}"
                        class="text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5 uppercase tracking-wider"
                      >Now</span>
                      <span class="text-[10px] text-slate-500 tabular-nums">${formatDuration(seg.durationMs)}</span>
                    </div>
                  </div>

                  <!-- Author + time -->
                  <div class="flex items-center gap-1.5 mt-1">
                    <span class="text-xs text-slate-400 truncate">${seg.authorDisplayName || seg.authorHandle || ''}</span>
                    ${age ? html`
                      <span class="text-slate-600 text-[10px]">·</span>
                      <span class="text-[10px] text-slate-500">${age}</span>
                    ` : ''}
                  </div>

                  <!-- Bottom row: category + engagement -->
                  <div class="flex items-center gap-2 mt-1.5">
                    ${seg.storyCategory ? html`
                      <span class="text-[10px] px-1.5 py-0.5 rounded-full border ${catStyle.bg} ${catStyle.text} ${catStyle.border}">${seg.storyCategory}</span>
                    ` : ''}
                    ${hasEngagement ? html`
                      <div class="flex items-center gap-2.5 text-[10px] text-slate-500">
                        ${likes > 0 ? html`
                          <span class="flex items-center gap-0.5">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"></path></svg>
                            ${formatCount(likes)}
                          </span>
                        ` : ''}
                        ${reposts > 0 ? html`
                          <span class="flex items-center gap-0.5">
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3"></path></svg>
                            ${formatCount(reposts)}
                          </span>
                        ` : ''}
                      </div>
                    ` : ''}
                  </div>
                </div>
              </div>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

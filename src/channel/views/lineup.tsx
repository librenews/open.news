import { html } from 'hono/html';
import type { PlayerSegment } from './player.js';

export function ProgramGuide({ segments }: { segments: PlayerSegment[] }) {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.round(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return html`
    <div class="bg-slate-900/30 border border-slate-800/40 rounded-2xl overflow-hidden">
      <!-- Header -->
      <div class="px-5 py-4 border-b border-slate-800/40">
        <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider">Program Guide</h3>
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

          return html`
            <div
              @click="playSegment(${pos})"
              x-bind:class="currentIndex === ${pos}
                ? 'bg-amber-400/5 border-l-2 border-l-amber-400 shadow-[inset_0_0_20px_rgba(251,191,36,0.05)]'
                : currentIndex > ${pos}
                  ? 'opacity-40 border-l-2 border-l-transparent hover:opacity-60'
                  : 'border-l-2 border-l-transparent hover:bg-slate-800/30'"
              class="px-5 py-3 cursor-pointer transition-all relative"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <!-- Story label -->
                  <p class="text-sm font-semibold text-slate-200 leading-snug truncate">
                    ${seg.type === 'interstitial' ? '↗ ' : ''}${escapeHtml(seg.storyLabel || 'Untitled')}
                  </p>
                  <!-- Creator -->
                  ${seg.authorDisplayName || seg.authorHandle ? html`
                    <p class="text-xs text-slate-400 mt-0.5 truncate">${escapeHtml(seg.authorDisplayName || seg.authorHandle || '')}</p>
                  ` : ''}
                </div>
                <div class="flex flex-col items-end gap-1 shrink-0">
                  <!-- NOW badge (only for current) -->
                  <span
                    x-show="currentIndex === ${pos}"
                    class="text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5 uppercase tracking-wider"
                  >Now</span>
                  <!-- Duration -->
                  <span class="text-[11px] text-slate-500 tabular-nums">${formatDuration(seg.durationMs)}</span>
                </div>
              </div>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

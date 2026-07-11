import { html } from 'hono/html';
import { ChannelPlayer, type PlayerSegment } from './player.js';
import { ProgramGuide } from './lineup.js';

export interface ChannelLineup {
  segments: PlayerSegment[];
  channelName: string;
  storyCount: number;
  totalDurationMs: number;
}

export function ChannelPage({
  lineup,
  channelName,
  channelSlug
}: {
  lineup: ChannelLineup | null;
  channelName: string;
  channelSlug: string;
}) {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  if (!lineup || !lineup.segments || lineup.segments.length === 0) {
    return html`
      <div class="fade-in">
        <div class="mb-6">
          <h1 class="title-font text-2xl md:text-3xl font-bold text-white">${escapeHtml(channelName)}</h1>
        </div>
        <div class="flex flex-col items-center justify-center py-24 bg-slate-900/20 border border-slate-800/40 rounded-3xl">
          <svg class="w-16 h-16 text-slate-700 mb-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z"></path>
          </svg>
          <p class="text-slate-400 text-sm font-semibold mb-1">No programming available</p>
          <p class="text-slate-600 text-xs">Check back soon — the next lineup is being generated.</p>
        </div>
      </div>
    `;
  }

  const videoSegments = lineup.segments.filter(s => s.type === 'video');
  const totalMinutes = Math.round(lineup.totalDurationMs / 60000);

  return html`
    <div class="fade-in">
      <!-- Channel Header -->
      <div class="mb-6">
        <h1 class="title-font text-2xl md:text-3xl font-bold text-white">${escapeHtml(channelName)}</h1>
        <p class="text-sm text-slate-400 mt-1">
          ${lineup.storyCount} stories · ${videoSegments.length} clips · ${totalMinutes} minutes
        </p>
      </div>

      <!-- Player + Guide Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Player (2/3 width on desktop) -->
        <div class="lg:col-span-2">
          ${ChannelPlayer({ segments: lineup.segments, channelName })}
        </div>

        <!-- Program Guide (1/3 width on desktop) -->
        <div class="lg:col-span-1">
          ${ProgramGuide({ segments: lineup.segments })}
        </div>
      </div>
    </div>
  `;
}

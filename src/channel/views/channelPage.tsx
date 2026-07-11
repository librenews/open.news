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
  channelSlug,
  isLoggedIn = false,
}: {
  lineup: ChannelLineup | null;
  channelName: string;
  channelSlug: string;
  isLoggedIn?: boolean;
}) {

  if (!lineup || !lineup.segments || lineup.segments.length === 0) {
    return html`
      <div class="fade-in">
        <div class="mb-6">
          <h1 class="title-font text-2xl md:text-3xl font-bold text-white">${channelName}</h1>
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
  const rssUrl = channelSlug && channelSlug !== 'all'
    ? `/rss/news/${channelSlug}`
    : '/rss/news';

  return html`
    <div class="fade-in">
      <!-- Channel Header -->
      <div class="mb-6">
        <div class="flex items-center gap-3">
          <h1 class="title-font text-2xl md:text-3xl font-bold text-white">${channelName}</h1>
          <a
            href="${rssUrl}"
            target="_blank"
            rel="noopener"
            title="RSS Feed"
            class="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 hover:border-amber-500/30 transition-all"
          >
            <svg class="w-3.5 h-3.5 text-amber-400 group-hover:text-amber-300 transition-colors" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="6.18" cy="17.82" r="2.18"/>
              <path d="M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z"/>
            </svg>
            <span class="text-xs font-medium text-amber-400/80 group-hover:text-amber-300 transition-colors hidden sm:inline">RSS</span>
          </a>
        </div>
        <p class="text-sm text-slate-400 mt-1">
          ${lineup.storyCount} stories · ${videoSegments.length} clips · ${totalMinutes} minutes
        </p>
      </div>

      <!-- Player + Guide Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Player (2/3 width on desktop) -->
        <div class="lg:col-span-2">
          ${ChannelPlayer({ segments: lineup.segments, channelName, isLoggedIn })}
        </div>

        <!-- Program Guide (1/3 width on desktop) -->
        <div class="lg:col-span-1">
          ${ProgramGuide({ segments: lineup.segments })}
        </div>
      </div>
    </div>
  `;
}

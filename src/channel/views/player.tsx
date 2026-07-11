import { html, raw } from 'hono/html';

export interface PlayerSegment {
  type: 'video' | 'ad_break' | 'interstitial';
  mediaId?: number;
  storyId?: string;
  storyLabel?: string;
  uri?: string;
  did?: string;
  cid?: string | null;
  thumbnailCid?: string | null;
  postText?: string | null;
  transcript?: string | null;
  authorHandle?: string;
  authorDisplayName?: string;
  authorAvatar?: string | null;
  durationMs: number;
  position: number;
  likeCount?: number;
  repostCount?: number;
}

export function ChannelPlayer({
  segments,
  channelName
}: {
  segments: PlayerSegment[];
  channelName: string;
}) {
  return html`
    <!-- Lineup data for Alpine -->
    <script id="lineup-data" type="application/json">${raw(JSON.stringify(segments))}</script>

    <div
      x-data="{
        segments: [],
        currentIndex: 0,
        isMuted: true,
        isPlaying: false,
        showUpNext: false,
        progress: 0,
        currentTime: 0,
        duration: 0,
        volume: 1,
        init() {
          this.segments = JSON.parse(document.getElementById('lineup-data').textContent);
          this.$watch('currentIndex', () => {
            this.showUpNext = false;
            this.progress = 0;
            this.currentTime = 0;
            this.duration = 0;
            this.$nextTick(() => this.loadCurrentSegment());
          });
          this.$nextTick(() => this.loadCurrentSegment());
        },
        get current() { return this.segments[this.currentIndex] || {}; },
        get next() { return this.segments[this.currentIndex + 1]; },
        get videoCount() { return this.segments.filter(s => s.type === 'video').length; },
        get videoIndex() { return this.segments.slice(0, this.currentIndex + 1).filter(s => s.type === 'video').length; },
        videoSrc() {
          const s = this.current;
          if (s.type !== 'video' || !s.did || !s.cid) return '';
          return '/video/proxy/' + encodeURIComponent(s.did) + '/' + encodeURIComponent(s.cid);
        },
        posterSrc() {
          const s = this.current;
          if (!s.did || !s.thumbnailCid) return '';
          return 'https://bsky.social/xrpc/com.atproto.sync.getBlob?did=' + encodeURIComponent(s.did) + '&cid=' + encodeURIComponent(s.thumbnailCid);
        },
        loadCurrentSegment() {
          const vid = this.$refs.videoEl;
          if (!vid) return;
          if (this.current.type === 'video') {
            vid.src = this.videoSrc();
            vid.poster = this.posterSrc();
            vid.load();
            vid.play().then(() => { this.isPlaying = true; }).catch(() => { this.isPlaying = false; });
          } else {
            this.isPlaying = false;
            setTimeout(() => this.nextSegment(), this.current.durationMs || 5000);
          }
        },
        togglePlay() {
          const vid = this.$refs.videoEl;
          if (!vid) return;
          if (vid.paused) { vid.play().catch(() => {}); this.isPlaying = true; }
          else { vid.pause(); this.isPlaying = false; }
        },
        rewind() {
          const vid = this.$refs.videoEl;
          if (vid) vid.currentTime = Math.max(0, vid.currentTime - 10);
        },
        seek(e) {
          const vid = this.$refs.videoEl;
          if (!vid || !vid.duration) return;
          const bar = e.currentTarget;
          const rect = bar.getBoundingClientRect();
          const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          vid.currentTime = pct * vid.duration;
        },
        nextSegment() {
          if (this.currentIndex < this.segments.length - 1) this.currentIndex++;
          else this.currentIndex = 0;
        },
        prevSegment() {
          if (this.currentIndex > 0) this.currentIndex--;
        },
        onEnded() { this.isPlaying = false; this.nextSegment(); },
        onTimeUpdate(e) {
          const vid = e.target;
          this.currentTime = vid.currentTime || 0;
          this.duration = vid.duration || 0;
          this.progress = vid.duration ? (vid.currentTime / vid.duration) * 100 : 0;
          if (vid.duration && vid.currentTime > vid.duration - 5) {
            this.showUpNext = true;
          } else {
            this.showUpNext = false;
          }
        },
        onPlay() { this.isPlaying = true; },
        onPause() { this.isPlaying = false; },
        toggleMute() {
          const vid = this.$refs.videoEl;
          if (!vid) return;
          if (this.isMuted) {
            this.isMuted = false;
            vid.muted = false;
            vid.volume = this.volume;
          } else {
            this.isMuted = true;
            vid.muted = true;
          }
        },
        setVolume(e) {
          const vid = this.$refs.videoEl;
          this.volume = parseFloat(e.target.value);
          if (vid) { vid.volume = this.volume; }
          if (this.volume > 0 && this.isMuted) { this.isMuted = false; if (vid) vid.muted = false; }
          if (this.volume === 0) { this.isMuted = true; if (vid) vid.muted = true; }
        },
        fmtTime(s) {
          if (!s || isNaN(s)) return '0:00';
          const m = Math.floor(s / 60);
          const sec = Math.floor(s % 60);
          return m + ':' + (sec < 10 ? '0' : '') + sec;
        },
      }"
      class="w-full"
    >
      <!-- Video Player Area -->
      <div class="relative w-full max-w-4xl mx-auto">

        <!-- Video element (shown for video segments) -->
        <div x-show="current.type === 'video'" class="relative rounded-2xl overflow-hidden bg-black aspect-video shadow-2xl">
          <video
            x-ref="videoEl"
            playsinline
            autoplay
            muted
            :muted="isMuted"
            @ended="onEnded()"
            @timeupdate="onTimeUpdate($event)"
            @play="onPlay()"
            @pause="onPause()"
            @click="togglePlay()"
            class="w-full h-full object-contain cursor-pointer"
          ></video>

          <!-- Click to Unmute overlay -->
          <div
            x-show="isMuted"
            @click="toggleMute()"
            class="absolute inset-0 z-20 flex items-center justify-center cursor-pointer group"
          >
            <div class="bg-black/60 backdrop-blur-sm rounded-2xl px-6 py-4 flex items-center gap-3 border border-white/10 group-hover:bg-black/70 transition-all">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path>
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"></path>
              </svg>
              <span class="text-white text-sm font-semibold">Click to unmute</span>
            </div>
          </div>

          <!-- Lower-third overlay -->
          <div class="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
            <div class="bg-gradient-to-t from-black/85 via-black/40 to-transparent px-6 pb-5 pt-16">
              <p x-show="current.storyLabel" class="text-lg font-bold text-white leading-snug mb-1" x-text="current.storyLabel"></p>
              <p x-show="current.authorDisplayName || current.authorHandle" class="text-sm text-slate-300">
                <span x-text="current.authorDisplayName || current.authorHandle"></span>
              </p>
              <p class="text-xs text-slate-400 mt-1">
                <span x-text="videoIndex"></span> of <span x-text="videoCount"></span>
              </p>
            </div>
          </div>

          <!-- Coming Up Next card -->
          <div
            x-show="showUpNext && next"
            x-transition:enter="transition ease-out duration-300"
            x-transition:enter-start="translate-x-full opacity-0"
            x-transition:enter-end="translate-x-0 opacity-100"
            x-transition:leave="transition ease-in duration-200"
            x-transition:leave-start="translate-x-0 opacity-100"
            x-transition:leave-end="translate-x-full opacity-0"
            class="absolute top-4 right-4 z-30 bg-black/80 backdrop-blur-md border border-white/10 rounded-xl p-4 max-w-[240px] shadow-2xl"
          >
            <p class="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">Coming Up Next</p>
            <p class="text-sm font-semibold text-white leading-snug" x-text="next?.storyLabel || 'Next clip'"></p>
            <p class="text-xs text-slate-400 mt-1" x-text="next?.authorDisplayName || next?.authorHandle || ''"></p>
          </div>
        </div>

        <!-- Interstitial card (shown for interstitial segments) -->
        <div
          x-show="current.type === 'interstitial'"
          class="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/60 aspect-video flex items-center justify-center shadow-2xl"
        >
          <div class="text-center px-8">
            <div class="inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/20 rounded-full px-4 py-1.5 mb-4">
              <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              <span class="text-xs font-bold text-amber-400 uppercase tracking-wider">Coming Up</span>
            </div>
            <p class="text-xl font-bold text-white title-font" x-text="current.storyLabel || 'Next Story'"></p>
          </div>
        </div>

        <!-- ═══ Transport Controls ═══ -->
        <div class="mt-3 space-y-2">

          <!-- Scrub / Progress Bar -->
          <div
            @click="seek($event)"
            class="group relative w-full h-1.5 bg-slate-800 rounded-full cursor-pointer hover:h-2.5 transition-all"
          >
            <!-- Buffered / played -->
            <div
              class="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all"
              :style="'width:' + progress + '%'"
            ></div>
            <!-- Thumb -->
            <div
              class="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
              :style="'left: calc(' + progress + '% - 6px)'"
            ></div>
          </div>

          <!-- Controls Row -->
          <div class="flex items-center justify-between px-0.5">

            <!-- Left: Transport -->
            <div class="flex items-center gap-1.5">
              <!-- Previous -->
              <button
                @click="prevSegment()"
                :disabled="currentIndex === 0"
                class="p-2 rounded-lg hover:bg-slate-800/60 text-slate-400 hover:text-white transition-all disabled:opacity-25 disabled:cursor-not-allowed"
                title="Previous clip"
              >
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M8.445 14.832A1 1 0 0010 14v-2.798l5.445 3.63A1 1 0 0017 14V6a1 1 0 00-1.555-.832L10 8.798V6a1 1 0 00-1.555-.832l-6 4a1 1 0 000 1.664l6 4z"></path></svg>
              </button>
              <!-- Rewind 10s -->
              <button
                @click="rewind()"
                class="p-2 rounded-lg hover:bg-slate-800/60 text-slate-400 hover:text-white transition-all"
                title="Rewind 10 seconds"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"></path>
                </svg>
              </button>
              <!-- Play / Pause -->
              <button
                @click="togglePlay()"
                class="p-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white transition-all"
                title="Play / Pause"
              >
                <!-- Play icon -->
                <svg x-show="!isPlaying" class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
                <!-- Pause icon -->
                <svg x-show="isPlaying" class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>
              </button>
              <!-- Next -->
              <button
                @click="nextSegment()"
                class="p-2 rounded-lg hover:bg-slate-800/60 text-slate-400 hover:text-white transition-all"
                title="Next clip"
              >
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M11.555 5.168A1 1 0 0010 6v2.798L4.555 5.168A1 1 0 003 6v8a1 1 0 001.555.832L10 11.202V14a1 1 0 001.555.832l6-4a1 1 0 000-1.664l-6-4z"></path></svg>
              </button>
            </div>

            <!-- Center: Time -->
            <span class="text-xs text-slate-500 font-medium tabular-nums">
              <span x-text="fmtTime(currentTime)"></span>
              <span class="text-slate-700"> / </span>
              <span x-text="fmtTime(duration)"></span>
              <span class="text-slate-700 ml-2">·</span>
              <span class="ml-2">Clip <span x-text="videoIndex"></span>/<span x-text="videoCount"></span></span>
            </span>

            <!-- Right: Volume -->
            <div class="flex items-center gap-2">
              <button
                @click="toggleMute()"
                class="p-2 rounded-lg hover:bg-slate-800/60 text-slate-400 hover:text-white transition-all"
                title="Mute / Unmute"
              >
                <!-- Volume on -->
                <svg x-show="!isMuted && volume > 0.5" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072M17.95 6.05a8 8 0 010 11.9M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path>
                </svg>
                <!-- Volume low -->
                <svg x-show="!isMuted && volume > 0 && volume <= 0.5" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path>
                </svg>
                <!-- Muted -->
                <svg x-show="isMuted || volume === 0" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"></path>
                  <path stroke-linecap="round" stroke-linejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"></path>
                </svg>
              </button>
              <input
                type="range"
                min="0" max="1" step="0.05"
                :value="isMuted ? 0 : volume"
                @input="setVolume($event)"
                class="w-20 h-1 bg-slate-700 rounded-full appearance-none cursor-pointer accent-amber-400 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-amber-400 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow"
                title="Volume"
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  `;
}

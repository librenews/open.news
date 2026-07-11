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
  channelName,
  isLoggedIn = false,
}: {
  segments: PlayerSegment[];
  channelName: string;
  isLoggedIn?: boolean;
}) {
  return html`
    <!-- Lineup data for Alpine -->
    <script id="lineup-data" type="application/json">${raw(JSON.stringify(segments))}</script>
    <script id="auth-state" type="application/json">${raw(JSON.stringify({ isLoggedIn }))}</script>

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
          const allSegments = JSON.parse(document.getElementById('lineup-data').textContent);
          // Filter out already-seen videos
          const seen = this.getSeenUris();
          this.segments = allSegments.filter(s => s.type !== 'video' || !s.uri || !seen.has(s.uri));
          // If all videos were seen, show the full lineup instead of empty
          if (this.segments.filter(s => s.type === 'video').length === 0) {
            this.segments = allSegments;
          }
          this.$watch('currentIndex', () => {
            this.showUpNext = false;
            this.progress = 0;
            this.currentTime = 0;
            this.duration = 0;
            this.liked = false;
            this.reposted = false;
            this.$nextTick(() => this.loadCurrentSegment());
          });
          this.initAuth();
          this.$nextTick(() => this.loadCurrentSegment());
        },
        // ── Seen tracking (cookie) ──
        getSeenUris() {
          try {
            const m = document.cookie.match(/(?:^|;\s*)onn_seen=([^;]*)/);
            if (m) return new Set(JSON.parse(decodeURIComponent(m[1])));
          } catch {}
          return new Set();
        },
        markSeen(uri) {
          if (!uri) return;
          const seen = this.getSeenUris();
          seen.add(uri);
          // Keep only last 200 entries to avoid cookie size limits
          const arr = [...seen].slice(-200);
          const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString();
          document.cookie = 'onn_seen=' + encodeURIComponent(JSON.stringify(arr)) + ';path=/;expires=' + expires + ';SameSite=Lax';
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
            // Mark as seen after 3 seconds of playback
            const seenUri = this.current.uri;
            clearTimeout(this._seenTimer);
            this._seenTimer = setTimeout(() => this.markSeen(seenUri), 3000);
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
        // ── Like / Repost ──
        isLoggedIn: false,
        liked: false,
        reposted: false,
        likeLoading: false,
        repostLoading: false,
        showLoginPrompt: false,
        initAuth() {
          const authData = JSON.parse(document.getElementById('auth-state').textContent);
          this.isLoggedIn = authData.isLoggedIn;
        },
        async doLike() {
          if (!this.isLoggedIn) { this.showLoginPrompt = true; return; }
          if (this.liked || this.likeLoading) return;
          this.likeLoading = true;
          try {
            const res = await fetch('/api/like', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uri: this.current.uri, cid: this.current.cid }),
            });
            if (res.ok) this.liked = true;
          } catch (e) { console.error('Like failed', e); }
          this.likeLoading = false;
        },
        async doRepost() {
          if (!this.isLoggedIn) { this.showLoginPrompt = true; return; }
          if (this.reposted || this.repostLoading) return;
          this.repostLoading = true;
          try {
            const res = await fetch('/api/repost', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uri: this.current.uri, cid: this.current.cid }),
            });
            if (res.ok) this.reposted = true;
          } catch (e) { console.error('Repost failed', e); }
          this.repostLoading = false;
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

            <!-- Center: Like / Repost / Time -->
            <div class="flex items-center gap-3">
              <!-- Like Button -->
              <button
                @click="doLike()"
                :class="liked ? 'text-rose-400 bg-rose-500/10' : 'text-slate-400 hover:text-rose-400 hover:bg-slate-800/60'"
                class="flex items-center gap-1 px-2 py-1.5 rounded-lg transition-all text-xs font-medium"
                :disabled="likeLoading"
                title="Like on Bluesky"
              >
                <svg class="w-4 h-4" :class="liked && 'scale-110'" :fill="liked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="transition: all 0.2s">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"></path>
                </svg>
                <span x-show="liked">Liked</span>
              </button>
              <!-- Repost Button -->
              <button
                @click="doRepost()"
                :class="reposted ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-400 hover:text-emerald-400 hover:bg-slate-800/60'"
                class="flex items-center gap-1 px-2 py-1.5 rounded-lg transition-all text-xs font-medium"
                :disabled="repostLoading"
                title="Repost on Bluesky"
              >
                <svg class="w-4 h-4" :class="reposted && 'scale-110'" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="transition: all 0.2s">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M4.5 12c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662"></path>
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14.25 7.5l2.25-2.25L14.25 3"></path>
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 16.5l-2.25 2.25 2.25 2.25"></path>
                </svg>
                <span x-show="reposted">Reposted</span>
              </button>
              <!-- Divider -->
              <span class="w-px h-4 bg-slate-800"></span>
              <!-- Time -->
              <span class="text-xs text-slate-500 font-medium tabular-nums">
                <span x-text="fmtTime(currentTime)"></span>
                <span class="text-slate-700"> / </span>
                <span x-text="fmtTime(duration)"></span>
                <span class="text-slate-700 ml-1">·</span>
                <span class="ml-1">Clip <span x-text="videoIndex"></span>/<span x-text="videoCount"></span></span>
              </span>
            </div>

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

      <!-- Login Prompt Modal (shown when non-logged-in user clicks like/repost) -->
      <div
        x-show="showLoginPrompt"
        x-transition:enter="transition ease-out duration-200"
        x-transition:enter-start="opacity-0"
        x-transition:enter-end="opacity-100"
        x-transition:leave="transition ease-in duration-150"
        x-transition:leave-start="opacity-100"
        x-transition:leave-end="opacity-0"
        @click.self="showLoginPrompt = false"
        @keydown.escape.window="showLoginPrompt = false"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      >
        <div
          @click.stop
          x-transition:enter="transition ease-out duration-200"
          x-transition:enter-start="opacity-0 scale-95 translate-y-4"
          x-transition:enter-end="opacity-100 scale-100 translate-y-0"
          class="bg-slate-900 border border-slate-800 rounded-2xl p-8 w-full max-w-sm shadow-2xl mx-4"
        >
          <div class="text-center mb-6">
            <div class="inline-flex items-center gap-2 mb-3">
              <svg class="w-6 h-6" style="filter: drop-shadow(0 0 6px rgba(245,158,11,0.4))" viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="32" r="5" fill="#f59e0b"/>
                <path d="M32 20a12 12 0 0 1 0 24a12 12 0 0 1 0-24" stroke="#f59e0b" stroke-width="4" stroke-dasharray="18.85 18.85" stroke-linecap="round"/>
                <path d="M32 12a20 20 0 0 1 0 40a20 20 0 0 1 0-40" stroke="#f59e0b" stroke-width="3.5" stroke-dasharray="31.42 31.42" stroke-linecap="round"/>
              </svg>
              <span class="text-lg font-extrabold text-white" style="font-family: Outfit, sans-serif">ONN</span>
            </div>
            <h2 class="text-xl font-bold text-white" style="font-family: Outfit, sans-serif">Sign in to interact</h2>
            <p class="text-sm text-slate-400 mt-1">Like and repost clips on the Bluesky network</p>
          </div>
          <form action="/oauth/login" method="GET">
            <input type="hidden" name="returnTo" value="/" />
            <div class="mb-4">
              <input
                type="text"
                name="handle"
                placeholder="your.bsky.social"
                required
                class="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 text-sm transition-all"
              />
            </div>
            <button
              type="submit"
              class="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-semibold text-sm hover:from-amber-400 hover:to-orange-400 transition-all shadow-lg shadow-amber-500/20"
            >
              Continue with Bluesky
            </button>
          </form>
          <button @click="showLoginPrompt = false" class="block w-full text-center text-xs text-slate-600 mt-4 hover:text-slate-400 transition-colors">
            Maybe later
          </button>
        </div>
      </div>
    </div>
  `;
}

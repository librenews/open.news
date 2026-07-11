import { html } from 'hono/html';

export function ChannelLayout({
  title,
  children,
  activeChannel = '',
  channels = [],
  user = null,
  channelSlug = '',
}: {
  title: string;
  children: any;
  activeChannel?: string;
  channels?: { slug: string; name: string }[];
  user?: { handle: string; displayName: string | null; avatarUrl: string | null } | null;
  channelSlug?: string;
}) {

  const rssFeedUrl = channelSlug && channelSlug !== 'all'
    ? `/rss/news/${channelSlug}`
    : '/rss/news';

  return html`
    <!DOCTYPE html>
    <html lang="en" class="h-full bg-slate-950">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <meta name="description" content="ONN — The Open News Network. Algorithmic video news from the open social web, powered by AT Protocol." />
        <link rel="icon" type="image/svg+xml" href="/static/onn-favicon.svg" />
        <link rel="alternate" type="application/rss+xml" title="${title} — RSS" href="${rssFeedUrl}" />
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
        <script src="https://cdn.tailwindcss.com"></script>
        <script src="https://unpkg.com/htmx.org@1.9.12"></script>
        <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
        <style>
          html, body {
            overflow-x: hidden;
            max-width: 100%;
            width: 100%;
          }
          body {
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: #020617;
            color: #f8fafc;
          }
          .title-font {
            font-family: 'Outfit', sans-serif;
          }
          .glass-nav {
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(20px) saturate(1.7);
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .fade-in {
            animation: fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
          }
          @keyframes livePulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.6); opacity: 0.4; }
          }
          .live-dot {
            animation: livePulse 1.8s ease-in-out infinite;
          }
          .onn-signal {
            filter: drop-shadow(0 0 6px rgba(245, 158, 11, 0.4));
          }
          .onn-signal:hover {
            filter: drop-shadow(0 0 10px rgba(245, 158, 11, 0.6));
          }
        </style>
      </head>
      <body class="min-h-full flex flex-col antialiased">
        <!-- Header -->
        <header class="glass-nav sticky top-0 z-50">
          <!-- Gradient top accent line -->
          <div class="h-[2px] bg-gradient-to-r from-red-500 to-amber-500"></div>
          <div class="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-6">
            <!-- Logo -->
            <a href="/" class="flex items-center gap-2.5 shrink-0 no-underline group">
              <svg class="onn-signal w-8 h-8 transition-all" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="32" cy="32" r="5" fill="#f59e0b"/>
                <path d="M32 20a12 12 0 0 1 0 24a12 12 0 0 1 0-24" stroke="#f59e0b" stroke-width="4" stroke-dasharray="18.85 18.85" stroke-linecap="round"/>
                <path d="M32 12a20 20 0 0 1 0 40a20 20 0 0 1 0-40" stroke="#f59e0b" stroke-width="3.5" stroke-dasharray="31.42 31.42" stroke-linecap="round"/>
                <path d="M32 5a27 27 0 0 1 0 54a27 27 0 0 1 0-54" stroke="#f59e0b" stroke-width="3" stroke-dasharray="42.41 42.41" stroke-linecap="round"/>
              </svg>
              <div class="flex flex-col leading-none">
                <span class="title-font text-[22px] font-extrabold tracking-tight text-white group-hover:text-amber-50 transition-colors">ONN</span>
                <span class="text-[9px] font-semibold tracking-[0.15em] text-slate-500 uppercase">Open News Network</span>
              </div>
            </a>

            <!-- Channel Tabs -->
            <nav class="hidden md:flex items-center gap-1 flex-1 justify-center">
              ${channels.map(ch => html`
                <a
                  href="/channel/${ch.slug}"
                  class="px-4 py-2 text-sm font-semibold rounded-lg transition-all no-underline ${activeChannel === ch.slug
                    ? 'text-amber-400 border-b-2 border-amber-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'}"
                >
                  ${ch.name}
                </a>
              `)}
            </nav>

            <!-- Right: LIVE + Auth -->
            <div class="flex items-center gap-3 shrink-0">
              <!-- LIVE Indicator -->
              <span class="relative flex items-center gap-1.5 bg-red-950/40 border border-red-900/40 rounded-full px-3 py-1 select-none">
                <span class="live-dot w-2 h-2 rounded-full bg-red-500 inline-block"></span>
                <span class="text-xs font-bold text-red-400 uppercase tracking-wider">Live</span>
              </span>

              ${user ? html`
                <!-- Logged-in user menu -->
                <div class="relative" x-data="{ open: false }">
                  <button
                    @click="open = !open"
                    @click.outside="open = false"
                    class="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 hover:bg-slate-800/60 transition-all"
                  >
                    ${user.avatarUrl
                      ? html`<img src="${user.avatarUrl}" alt="" class="w-7 h-7 rounded-full object-cover border border-slate-700" />`
                      : html`<div class="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-xs font-bold text-white">${(user.displayName || user.handle)[0].toUpperCase()}</div>`
                    }
                    <span class="text-sm font-medium text-slate-300 hidden sm:inline max-w-[120px] truncate">${user.displayName || user.handle}</span>
                    <svg class="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"></path></svg>
                  </button>
                  <!-- Dropdown -->
                  <div
                    x-show="open"
                    x-transition:enter="transition ease-out duration-150"
                    x-transition:enter-start="opacity-0 scale-95"
                    x-transition:enter-end="opacity-100 scale-100"
                    x-transition:leave="transition ease-in duration-100"
                    x-transition:leave-start="opacity-100 scale-100"
                    x-transition:leave-end="opacity-0 scale-95"
                    class="absolute right-0 mt-2 w-56 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden z-50"
                  >
                    <div class="px-4 py-3 border-b border-slate-800">
                      <p class="text-sm font-semibold text-white truncate">${user.displayName || user.handle}</p>
                      <p class="text-xs text-slate-500 truncate">@${user.handle}</p>
                    </div>
                    <div class="py-1">
                      <a href="https://bsky.app/profile/${user.handle}" target="_blank" rel="noopener" class="flex items-center gap-2 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors no-underline">
                        <svg class="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                        Bluesky Profile
                      </a>
                      <form action="/oauth/logout" method="POST" class="m-0">
                        <button type="submit" class="flex items-center gap-2 w-full px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors text-left">
                          <svg class="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                          Sign Out
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              ` : html`
                <!-- Sign In button + modal -->
                <div x-data="{ showLogin: false }">
                  <button
                    @click="showLogin = true"
                    class="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-semibold hover:bg-amber-500/20 transition-all"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0"></path></svg>
                    Sign In
                  </button>

                  <!-- Login Modal -->
                  <div
                    x-show="showLogin"
                    x-transition:enter="transition ease-out duration-200"
                    x-transition:enter-start="opacity-0"
                    x-transition:enter-end="opacity-100"
                    x-transition:leave="transition ease-in duration-150"
                    x-transition:leave-start="opacity-100"
                    x-transition:leave-end="opacity-0"
                    @click.self="showLogin = false"
                    @keydown.escape.window="showLogin = false"
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
                          <svg class="onn-signal w-6 h-6" viewBox="0 0 64 64" fill="none">
                            <circle cx="32" cy="32" r="5" fill="#f59e0b"/>
                            <path d="M32 20a12 12 0 0 1 0 24a12 12 0 0 1 0-24" stroke="#f59e0b" stroke-width="4" stroke-dasharray="18.85 18.85" stroke-linecap="round"/>
                            <path d="M32 12a20 20 0 0 1 0 40a20 20 0 0 1 0-40" stroke="#f59e0b" stroke-width="3.5" stroke-dasharray="31.42 31.42" stroke-linecap="round"/>
                          </svg>
                          <span class="title-font text-lg font-extrabold text-white">ONN</span>
                        </div>
                        <h2 class="text-xl font-bold text-white title-font">Sign in with Bluesky</h2>
                        <p class="text-sm text-slate-400 mt-1">Enter your Bluesky handle to continue</p>
                      </div>
                      <form action="/oauth/login" method="GET">
                        <input type="hidden" name="returnTo" value="/" />
                        <div class="mb-4">
                          <input
                            type="text"
                            name="handle"
                            placeholder="your.bsky.social"
                            required
                            autofocus
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
                      <p class="text-center text-xs text-slate-600 mt-4">
                        No account? <a href="https://bsky.app" target="_blank" rel="noopener" class="text-amber-500 hover:text-amber-400 no-underline">Join Bluesky</a>
                      </p>
                    </div>
                  </div>
                </div>
              `}
            </div>
          </div>

          <!-- Mobile Channel Tabs -->
          <div class="md:hidden flex items-center gap-1 px-4 pb-2 overflow-x-auto scrollbar-hide">
            ${channels.map(ch => html`
              <a
                href="/channel/${ch.slug}"
                class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all no-underline whitespace-nowrap ${activeChannel === ch.slug
                  ? 'text-amber-400 bg-amber-400/10 border border-amber-400/20'
                  : 'text-slate-400 hover:text-slate-200'}"
              >
                ${ch.name}
              </a>
            `)}
          </div>
        </header>

        <!-- Main Content -->
        <main class="flex-1 max-w-7xl w-full mx-auto px-6 py-6 md:py-8">
          ${children}
        </main>

        <!-- Footer -->
        <footer class="border-t border-slate-900 py-6 text-center text-xs text-slate-600">
          ONN · The Open News Network · Powered by <a href="https://atproto.com" target="_blank" rel="noopener" class="text-slate-500 hover:text-amber-400 transition-colors no-underline">AT Protocol</a>
        </footer>
      </body>
    </html>
  `;
}

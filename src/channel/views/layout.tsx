import { html } from 'hono/html';

export function ChannelLayout({
  title,
  children,
  activeChannel = '',
  channels = []
}: {
  title: string;
  children: any;
  activeChannel?: string;
  channels?: { slug: string; name: string }[];
}) {

  return html`
    <!DOCTYPE html>
    <html lang="en" class="h-full bg-slate-950">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <meta name="description" content="ONN — The Open News Network. Algorithmic video news from the open social web, powered by AT Protocol." />
        <link rel="icon" type="image/png" href="/static/onn-favicon.png" />
        <link rel="icon" type="image/svg+xml" href="/static/onn-favicon.svg" />
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

            <!-- LIVE Indicator -->
            <div class="flex items-center gap-2 shrink-0 select-none">
              <span class="relative flex items-center gap-1.5 bg-red-950/40 border border-red-900/40 rounded-full px-3 py-1">
                <span class="live-dot w-2 h-2 rounded-full bg-red-500 inline-block"></span>
                <span class="text-xs font-bold text-red-400 uppercase tracking-wider">Live</span>
              </span>
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

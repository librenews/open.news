import { html } from 'hono/html';

export interface SnipProfile {
  did: string;
  handle: string;
  avatar?: string;
  displayName?: string;
}

export function SnipLayout({
  title,
  children,
  session,
  activeTab = '',
  q = '',
  type = 'top',
  headExtra = ''
}: {
  title: string;
  children: any;
  session?: SnipProfile | null;
  activeTab?: string;
  q?: string;
  type?: string;
  headExtra?: any;
}) {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return html`
    <!DOCTYPE html>
    <html lang="en" class="h-full bg-slate-950">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(title)}</title>
        <meta name="description" content="Snip — Curated high-signal short videos from the open social web." />
        <link rel="icon" type="image/png" href="/favicon.png">
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
        <script src="https://cdn.tailwindcss.com"></script>
        <script src="https://unpkg.com/htmx.org@1.9.12"></script>
        <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
        ${headExtra}
        <style>
          body {
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: #020617;
            color: #f8fafc;
          }
          .title-font {
            font-family: 'Outfit', sans-serif;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .fade-in {
            animation: fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
          }
          .glass-nav {
            background: rgba(15, 23, 42, 0.75);
            backdrop-filter: blur(20px) saturate(1.7);
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          }
          .video-card {
            background: rgba(30, 41, 59, 0.4);
            border: 1px solid rgba(255, 255, 255, 0.05);
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          }
          .video-card:hover {
            transform: translateY(-2px);
            background: rgba(30, 41, 59, 0.6);
            border-color: rgba(99, 102, 241, 0.25);
            box-shadow: 0 12px 20px -8px rgba(0, 0, 0, 0.4);
          }
        </style>
      </head>
      <body class="min-h-full flex flex-col antialiased">
        <!-- Header -->
        <header class="glass-nav sticky top-0 z-50">
          <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
            <!-- Logo -->
            <a href="/" class="title-font text-2xl font-black bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent tracking-tight hover:opacity-95 transition-opacity shrink-0 no-underline">
              snip<span>.</span>
            </a>

            <!-- Search -->
            <form action="/" method="GET" class="flex-1 max-w-lg relative group">
              <input type="hidden" name="type" value="${escapeHtml(type)}">
              <div class="absolute inset-0 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 rounded-xl blur-lg opacity-0 group-focus-within:opacity-100 transition-opacity"></div>
              <div class="relative flex items-center bg-slate-900/60 border border-slate-800 focus-within:border-indigo-500/50 rounded-xl overflow-hidden transition-all shadow-inner">
                <svg class="w-4 h-4 text-slate-500 ml-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                </svg>
                <input
                  type="text"
                  name="q"
                  value="${escapeHtml(q)}"
                  placeholder="Search spoken audio transcripts..."
                  class="w-full px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none bg-transparent"
                />
              </div>
            </form>

            <!-- Nav Links / Profile -->
            <div class="flex items-center gap-4 shrink-0 text-sm font-semibold text-slate-300">
              <a href="/leaderboard" class="hover:text-indigo-400 transition-colors no-underline ${activeTab === 'leaderboard' ? 'text-indigo-400' : ''}">Top Creators</a>
              <span class="text-slate-800">|</span>
              ${session ? html`
                <div class="flex items-center gap-3" x-data="{ open: false }">
                  <button @click="open = !open" class="flex items-center gap-2 focus:outline-none group cursor-pointer">
                    ${session.avatar ? html`<img src="${session.avatar}" class="w-7 h-7 rounded-full border border-slate-700 group-hover:border-indigo-400 transition-colors" />` : html`<div class="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center font-bold border border-slate-700">?</div>`}
                    <span class="text-xs max-w-[100px] truncate group-hover:text-indigo-400 transition-colors">${escapeHtml(session.displayName || session.handle)}</span>
                  </button>
                  <!-- Dropdown menu -->
                  <div x-show="open" @click.away="open = false" class="absolute right-6 top-14 bg-slate-900 border border-slate-800 rounded-xl py-1.5 w-40 shadow-xl" x-cloak>
                    <a href="/profile/${session.did}" class="block px-4 py-2 text-xs hover:bg-slate-800 text-slate-300 no-underline hover:text-white">My Profile</a>
                    <form action="/oauth/logout" method="POST" class="block w-full">
                      <button type="submit" class="w-full text-left px-4 py-2 text-xs text-red-400 hover:bg-slate-800 cursor-pointer">Logout</button>
                    </form>
                  </div>
                </div>
              ` : html`
                <a href="/login" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl transition-all no-underline shadow-lg shadow-indigo-600/10">Sign in</a>
              `}
            </div>
          </div>
        </header>

        <!-- Main Workspace -->
        <main class="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
          ${children}
        </main>

        <!-- Footer -->
        <footer class="border-t border-slate-900 py-6 text-center text-xs text-slate-600">
          snip.social · Powered by <a href="https://atproto.com" target="_blank" rel="noopener" class="text-slate-500 hover:text-indigo-400 transition-colors no-underline">AT Protocol</a>
        </footer>
      </body>
    </html>
  `;
}

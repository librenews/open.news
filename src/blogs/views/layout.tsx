import { html, raw } from 'hono/html';

export function BlogsLayout({ title, children, session }: { title: string; children: any; session?: { did: string; handle: string } | null }) {
  return html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <meta name="description" content="Discover and follow blogs across Bluesky, Mastodon, RSS, and the open social web." />
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          :root {
            --bg: #0a0a0c;
            --bg-card: #131318;
            --bg-hover: #1a1a22;
            --bg-surface: #0f0f14;
            --border: rgba(255,255,255,0.06);
            --border-hover: rgba(255,255,255,0.12);
            --text: rgba(255,255,255,0.93);
            --text-secondary: rgba(255,255,255,0.65);
            --text-muted: rgba(255,255,255,0.4);
            --accent: #6366f1;
            --accent-hover: #818cf8;
            --accent-dim: rgba(99,102,241,0.12);
            --green: #10b981;
            --green-dim: rgba(16,185,129,0.12);
            --red: #ef4444;
            --font: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            --radius: 12px;
            --column-width: 620px;
          }

          * { box-sizing: border-box; margin: 0; padding: 0; }
          html { overflow-y: scroll; }
          body {
            background: var(--bg);
            color: var(--text);
            font-family: var(--font);
            -webkit-font-smoothing: antialiased;
            line-height: 1.55;
          }
          a { color: var(--accent); text-decoration: none; }
          a:hover { color: var(--accent-hover); }

          /* ── Header ───────────────────────────────────────── */
          .bl-header {
            position: sticky;
            top: 0;
            z-index: 100;
            background: rgba(10,10,12,0.8);
            backdrop-filter: blur(16px) saturate(1.5);
            border-bottom: 1px solid var(--border);
          }
          .bl-header-inner {
            max-width: var(--column-width);
            margin: 0 auto;
            padding: 0 1rem;
            height: 52px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .bl-logo {
            font-size: 1.15rem;
            font-weight: 700;
            color: var(--text);
            text-decoration: none;
            letter-spacing: -0.04em;
          }
          .bl-logo span { color: var(--accent); }
          .bl-header-actions {
            display: flex;
            align-items: center;
            gap: 0.75rem;
          }
          .bl-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            font-size: 0.78rem;
            font-weight: 600;
            padding: 0.4rem 0.85rem;
            border-radius: 99px;
            border: none;
            cursor: pointer;
            transition: all 0.15s;
            text-decoration: none;
            font-family: var(--font);
          }
          .bl-btn-primary {
            background: var(--accent);
            color: white;
          }
          .bl-btn-primary:hover { background: var(--accent-hover); color: white; }
          .bl-btn-outline {
            background: transparent;
            color: var(--text-secondary);
            border: 1px solid var(--border);
          }
          .bl-btn-outline:hover { border-color: var(--border-hover); color: var(--text); }

          /* ── Feed Column ──────────────────────────────────── */
          .bl-feed {
            max-width: var(--column-width);
            margin: 0 auto;
            padding: 0 1rem;
          }

          /* ── New Posts Banner ──────────────────────────────── */
          .bl-new-posts {
            display: none;
            width: 100%;
            padding: 0.6rem;
            margin: 0;
            border: none;
            border-bottom: 1px solid var(--border);
            background: var(--accent-dim);
            color: var(--accent-hover);
            font-family: var(--font);
            font-size: 0.82rem;
            font-weight: 600;
            cursor: pointer;
            text-align: center;
            transition: background 0.2s;
            position: sticky;
            top: 0;
            z-index: 10;
          }
          .bl-new-posts:hover { background: rgba(99,102,241,0.18); }
          .bl-new-posts.visible { display: block; }

          /* ── Post Card ────────────────────────────────────── */
          .bl-post {
            padding: 1rem 0;
            border-bottom: 1px solid var(--border);
          }
          .bl-post:last-child { border-bottom: none; }

          .bl-post-header {
            display: flex;
            align-items: center;
            gap: 0.55rem;
            margin-bottom: 0.45rem;
          }
          .bl-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            object-fit: cover;
            background: var(--bg-hover);
            flex-shrink: 0;
          }
          .bl-avatar-ph {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: var(--accent-dim);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--accent);
            flex-shrink: 0;
          }
          .bl-post-meta { flex: 1; min-width: 0; }
          .bl-post-author {
            font-size: 0.82rem;
            font-weight: 600;
            color: var(--text);
            text-decoration: none;
          }
          .bl-post-author:hover { color: var(--accent); }
          .bl-post-handle {
            font-size: 0.75rem;
            color: var(--text-muted);
            margin-left: 0.35rem;
          }
          .bl-post-time {
            font-size: 0.72rem;
            color: var(--text-muted);
          }

          /* ── Post Content ─────────────────────────────────── */
          .bl-post-title {
            font-size: 1rem;
            font-weight: 700;
            letter-spacing: -0.01em;
            margin-bottom: 0.3rem;
            line-height: 1.35;
          }
          .bl-post-title a {
            color: var(--text);
            text-decoration: none;
          }
          .bl-post-title a:hover { color: var(--accent); }

          .bl-post-body {
            font-size: 0.88rem;
            line-height: 1.6;
            color: var(--text-secondary);
            overflow: hidden;
          }
          .bl-post-body p { margin-bottom: 0.4em; }
          .bl-post-body p:last-child { margin-bottom: 0; }
          .bl-post-body h1, .bl-post-body h2, .bl-post-body h3 {
            font-size: 0.92rem;
            font-weight: 600;
            color: var(--text);
            margin: 0.6em 0 0.3em;
          }
          .bl-post-body h1:first-child, .bl-post-body h2:first-child { margin-top: 0; }
          .bl-post-body code {
            font-size: 0.82em;
            background: var(--bg-hover);
            padding: 0.15em 0.35em;
            border-radius: 4px;
          }
          .bl-post-body pre {
            background: var(--bg-hover);
            padding: 0.7rem;
            border-radius: 8px;
            overflow-x: auto;
            font-size: 0.8rem;
            margin: 0.5em 0;
          }
          .bl-post-body pre code { background: none; padding: 0; }
          .bl-post-body blockquote {
            border-left: 3px solid var(--accent-dim);
            padding-left: 0.8rem;
            color: var(--text-muted);
            margin: 0.5em 0;
          }
          .bl-post-body a { color: var(--accent); }
          .bl-post-body ul, .bl-post-body ol {
            padding-left: 1.3rem;
            margin: 0.4em 0;
          }
          .bl-post-body img {
            max-width: 100%;
            border-radius: 8px;
            margin: 0.5em 0;
          }

          .bl-post-footer {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-top: 0.5rem;
            flex-wrap: wrap;
            overflow: hidden;
            max-height: 3rem;
          }
          .bl-source {
            display: inline-flex;
            align-items: center;
            gap: 0.2rem;
            font-size: 0.7rem;
            color: var(--text-muted);
            padding: 0.15rem 0.45rem;
            background: var(--bg-hover);
            border-radius: 99px;
            text-decoration: none;
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .bl-source:hover { color: var(--text-secondary); }
          .bl-tag {
            font-size: 0.68rem;
            color: var(--accent);
            background: var(--accent-dim);
            padding: 0.12rem 0.4rem;
            border-radius: 99px;
            max-width: 160px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          /* ── Read More ────────────────────────────────────── */
          .bl-read-more {
            font-size: 0.78rem;
            color: var(--accent);
            font-weight: 500;
          }

          /* ── Loading / empty ──────────────────────────────── */
          .bl-empty {
            text-align: center;
            padding: 4rem 2rem;
            color: var(--text-muted);
          }
          .bl-empty h2 {
            font-size: 1.1rem;
            color: var(--text-secondary);
            margin-bottom: 0.3rem;
          }

          /* ── Pagination ───────────────────────────────────── */
          .bl-pagination {
            display: flex;
            justify-content: center;
            gap: 1rem;
            padding: 1.5rem 0 3rem;
          }
          .bl-pagination a {
            font-size: 0.82rem;
            color: var(--accent);
          }
          .bl-pagination span {
            font-size: 0.78rem;
            color: var(--text-muted);
          }

          /* ── Responsive ───────────────────────────────────── */
          @media (max-width: 640px) {
            .bl-header-inner { padding: 0 0.75rem; }
            .bl-feed { padding: 0 0.75rem; }
          }
        </style>
      </head>
      <body>
        <header class="bl-header">
          <div class="bl-header-inner">
            <a href="/" class="bl-logo">blogs<span>.social</span></a>
            <div class="bl-header-actions">
              ${session
                ? html`
                  <a href="/compose" class="bl-btn bl-btn-primary">✎ Write</a>
                  <a href="/author/${session.did}" class="bl-btn bl-btn-outline">${session.handle}</a>
                `
                : html`<a href="/auth/login" class="bl-btn bl-btn-primary">Sign in</a>`
              }
            </div>
          </div>
        </header>
        ${children}
      </body>
    </html>
  `;
}

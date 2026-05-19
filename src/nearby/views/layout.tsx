import { html } from 'hono/html';

export function NearbyLayout({ title, children, currentPlaceId }: { title: string; children: any; currentPlaceId?: string }) {
  return html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <meta name="description" content="Discover local news and conversations happening near you on Bluesky and the AT Protocol." />
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          :root {
            --bg: #0f1115;
            --bg-card: #16181d;
            --bg-hover: #1c1f26;
            --border: rgba(255,255,255,0.06);
            --text: rgba(255,255,255,0.92);
            --text-muted: rgba(255,255,255,0.5);
            --text-dim: rgba(255,255,255,0.3);
            --accent: #3b82f6;
            --accent-dim: rgba(59,130,246,0.15);
            --green: #10b981;
            --font: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }

          * { box-sizing: border-box; margin: 0; padding: 0; }

          html { overflow-y: scroll; }

          body {
            background: var(--bg);
            color: var(--text);
            font-family: var(--font);
            -webkit-font-smoothing: antialiased;
            line-height: 1.5;
          }

          a { color: var(--accent); text-decoration: none; }
          a:hover { text-decoration: underline; }

          /* ── Header ───────────────────────────────── */
          .nb-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.75rem 1.5rem;
            border-bottom: 1px solid var(--border);
            position: sticky;
            top: 0;
            background: rgba(15,17,21,0.85);
            backdrop-filter: blur(12px);
            z-index: 100;
          }

          .nb-logo {
            font-size: 1.25rem;
            font-weight: 700;
            color: var(--text);
            text-decoration: none;
            letter-spacing: -0.03em;
          }
          .nb-logo span { color: var(--accent); }

          .nb-city-select {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 0.4rem 0.8rem;
            color: var(--text);
            font-size: 0.85rem;
            font-weight: 500;
            cursor: pointer;
            transition: border-color 0.2s;
          }
          .nb-city-select:hover { border-color: var(--accent); }
          .nb-city-select svg { opacity: 0.5; }

          /* ── Layout ───────────────────────────────── */
          .nb-main {
            display: grid;
            grid-template-columns: 220px 1fr 240px;
            max-width: 1100px;
            margin: 0 auto;
            gap: 1.5rem;
            padding: 1.5rem;
            min-height: calc(100vh - 56px);
          }

          @media (max-width: 900px) {
            .nb-main { grid-template-columns: 1fr; }
            .nb-sidebar, .nb-aside { display: none; }
          }

          /* ── Sidebar ──────────────────────────────── */
          .nb-sidebar { position: sticky; top: 72px; align-self: start; }

          .nb-sidebar h3 {
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--text-dim);
            margin-bottom: 0.75rem;
          }

          .nb-city-list { list-style: none; }

          .nb-city-list li a {
            display: flex;
            justify-content: space-between;
            padding: 0.35rem 0.6rem;
            border-radius: 6px;
            font-size: 0.82rem;
            color: var(--text-muted);
            transition: all 0.15s;
          }
          .nb-city-list li a:hover {
            background: var(--bg-hover);
            color: var(--text);
            text-decoration: none;
          }
          .nb-city-list li a.active {
            background: var(--accent-dim);
            color: var(--accent);
          }
          .nb-city-list .count {
            font-size: 0.72rem;
            color: var(--text-dim);
            font-variant-numeric: tabular-nums;
          }

          /* ── Feed ─────────────────────────────────── */
          .nb-feed { min-width: 0; }

          .nb-feed-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 1rem;
          }
          .nb-feed-header h1 {
            font-size: 1.3rem;
            font-weight: 700;
            letter-spacing: -0.02em;
          }
          .nb-feed-header .subtitle {
            font-size: 0.8rem;
            color: var(--text-muted);
          }

          /* ── Card ─────────────────────────────────── */
          .nb-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 1rem 1.1rem;
            margin-bottom: 0.75rem;
            transition: border-color 0.2s, transform 0.15s;
          }
          .nb-card:hover {
            border-color: rgba(255,255,255,0.12);
            transform: translateY(-1px);
          }

          .nb-card-header {
            display: flex;
            align-items: center;
            gap: 0.6rem;
            margin-bottom: 0.5rem;
          }

          .nb-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            object-fit: cover;
            background: var(--bg-hover);
            flex-shrink: 0;
          }

          .nb-avatar-placeholder {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: var(--accent-dim);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.75rem;
            font-weight: 600;
            color: var(--accent);
            flex-shrink: 0;
          }

          .nb-card-meta {
            flex: 1;
            min-width: 0;
          }
          .nb-card-meta .handle {
            font-size: 0.82rem;
            font-weight: 600;
            color: var(--text);
          }
          .nb-card-meta .time {
            font-size: 0.72rem;
            color: var(--text-dim);
          }

          .nb-card-body {
            font-size: 0.88rem;
            line-height: 1.55;
            color: var(--text);
          }
          .nb-card-body a { color: var(--text); }
          .nb-card-body a:hover { color: var(--accent); text-decoration: none; }

          .nb-card-title {
            font-weight: 600;
            font-size: 0.92rem;
            margin-bottom: 0.25rem;
          }
          .nb-card-description {
            font-size: 0.82rem;
            color: var(--text-muted);
            margin-bottom: 0.4rem;
          }

          .nb-tags {
            display: flex;
            gap: 0.4rem;
            margin-top: 0.6rem;
            flex-wrap: wrap;
          }

          .nb-tag {
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            font-size: 0.68rem;
            font-weight: 500;
            padding: 0.2rem 0.5rem;
            border-radius: 99px;
            background: var(--bg-hover);
            color: var(--text-muted);
          }
          .nb-tag.post { background: rgba(59,130,246,0.1); color: #60a5fa; }
          .nb-tag.article { background: rgba(16,185,129,0.1); color: #34d399; }
          .nb-tag.city { background: rgba(255,255,255,0.04); }

          /* ── Aside ────────────────────────────────── */
          .nb-aside { position: sticky; top: 72px; align-self: start; }

          .nb-aside h3 {
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--text-dim);
            margin-bottom: 0.75rem;
          }

          .nb-account-card {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.4rem 0;
          }
          .nb-account-card .handle {
            font-size: 0.8rem;
            font-weight: 500;
            color: var(--text);
          }
          .nb-account-card .posts {
            font-size: 0.7rem;
            color: var(--text-dim);
          }

          /* ── Empty state ──────────────────────────── */
          .nb-empty {
            text-align: center;
            padding: 4rem 2rem;
            color: var(--text-muted);
          }
          .nb-empty h2 { font-size: 1.1rem; margin-bottom: 0.5rem; color: var(--text); }
          .nb-empty p { font-size: 0.85rem; }

          /* ── City grid (landing) ──────────────────── */
          .nb-city-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 0.75rem;
          }
          .nb-city-tile {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 1rem 1.1rem;
            transition: border-color 0.2s, transform 0.15s;
            text-decoration: none !important;
            display: block;
          }
          .nb-city-tile:hover {
            border-color: var(--accent);
            transform: translateY(-2px);
          }
          .nb-city-tile .name {
            font-weight: 600;
            font-size: 0.95rem;
            color: var(--text);
            margin-bottom: 0.3rem;
          }
          .nb-city-tile .stats {
            font-size: 0.75rem;
            color: var(--text-muted);
          }
          .nb-city-tile .country {
            font-size: 0.7rem;
            color: var(--text-dim);
            margin-top: 0.2rem;
          }
        </style>
      </head>
      <body>
        <header class="nb-header">
          <a href="/" class="nb-logo">nearby<span>.at</span></a>
          ${currentPlaceId ? '' : ''}
        </header>
        ${children}
      </body>
    </html>
  `;
}

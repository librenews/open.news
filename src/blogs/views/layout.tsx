import { html, raw } from 'hono/html';

export interface BlogsProfile { did: string; handle: string; avatar?: string; displayName?: string }

export function BlogsLayout({ title, children, session, navPage = '', headExtra = '' }: { title: string; children: any; session?: BlogsProfile | null; navPage?: string; headExtra?: any }) {
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
        ${headExtra}
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
            max-width: 1240px;
            margin: 0 auto;
            padding: 0 0.75rem;
            height: 52px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }
          .bl-logo {
            width: 196px;
            flex-shrink: 0;
            font-size: 1.15rem;
            font-weight: 700;
            color: var(--text);
            text-decoration: none;
            letter-spacing: -0.04em;
            padding-left: 0.75rem;
          }
          .bl-logo span { color: var(--accent); }
          .bl-header-search {
            flex: 1;
            max-width: 420px;
            position: relative;
          }
          .bl-header-search input {
            width: 100%;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 0.4rem 0.75rem 0.4rem 2.1rem;
            font-size: 0.82rem;
            color: var(--text);
            font-family: var(--font);
            outline: none;
            transition: border-color 0.15s;
          }
          .bl-header-search input:focus { border-color: var(--accent); }
          .bl-header-search input::placeholder { color: var(--text-muted); }
          .bl-header-search svg {
            position: absolute;
            left: 0.6rem;
            top: 50%;
            transform: translateY(-50%);
            width: 14px;
            height: 14px;
            color: var(--text-muted);
            pointer-events: none;
          }
          .bl-header-spacer { flex: 1; }
          .bl-header-actions {
            display: flex;
            align-items: center;
            gap: 0.75rem;
          }
          /* Avatar user dropdown */
          .bl-user-menu {
            position: relative;
            cursor: pointer;
          }
          .bl-user-menu img {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            object-fit: cover;
            display: block;
          }
          .bl-user-placeholder {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            background: var(--accent-dim);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--accent);
            font-size: 0.75rem;
            font-weight: 700;
          }
          .bl-user-dropdown {
            display: none;
            position: absolute;
            top: 100%;
            right: 0;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.45);
            min-width: 190px;
            z-index: 50;
          }
          .bl-user-dropdown::before {
            content: '';
            position: absolute;
            top: -8px;
            left: 0;
            right: 0;
            height: 8px;
          }
          .bl-user-menu:hover .bl-user-dropdown {
            display: block;
          }
          .bl-user-dropdown-header {
            padding: 0.65rem 1rem;
            border-bottom: 1px solid var(--border);
          }
          .bl-user-dropdown-name {
            font-weight: 600;
            font-size: 0.85rem;
            color: var(--text);
          }
          .bl-user-dropdown-handle {
            font-size: 0.72rem;
            color: var(--text-muted);
          }
          .bl-user-dropdown a {
            display: block;
            padding: 0.55rem 1rem;
            font-size: 0.82rem;
            color: var(--text-secondary);
            text-decoration: none;
            font-weight: 500;
            transition: background 0.1s;
          }
          .bl-user-dropdown a:hover {
            background: var(--bg-hover);
            color: var(--text);
          }
          .bl-user-dropdown .bl-signout-link {
            color: var(--red);
            border-top: 1px solid var(--border);
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

          /* ── Compose Modal ────────────────────────────────────── */
          .bl-compose-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.6);
            backdrop-filter: blur(4px);
            z-index: 1000;
            align-items: flex-start;
            justify-content: center;
            padding-top: 80px;
          }
          .bl-compose-overlay.open { display: flex; }
          .bl-compose-modal {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 14px;
            width: 100%;
            max-width: 560px;
            box-shadow: 0 24px 64px rgba(0,0,0,0.5);
            overflow: hidden;
          }
          .bl-compose-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 1rem 1.25rem 0.75rem;
            border-bottom: 1px solid var(--border);
          }
          .bl-compose-title { font-size: 0.88rem; font-weight: 700; }
          .bl-compose-close {
            background: none; border: none; color: var(--text-muted);
            font-size: 1rem; cursor: pointer; padding: 0.2rem 0.4rem;
            border-radius: 4px; line-height: 1;
          }
          .bl-compose-close:hover { color: var(--text); background: var(--bg); }
          .bl-compose-title-input {
            width: 100%;
            background: none;
            border: none;
            border-bottom: 1px solid var(--border);
            padding: 0.9rem 1.25rem;
            font-size: 1rem;
            font-weight: 600;
            color: var(--text);
            font-family: var(--font);
            outline: none;
            box-sizing: border-box;
          }
          .bl-compose-title-input::placeholder { color: var(--text-muted); font-weight: 400; }
          .bl-compose-editor {
            min-height: 140px;
            max-height: 340px;
            overflow-y: auto;
            padding: 1rem 1.25rem;
            font-size: 0.92rem;
            line-height: 1.6;
            color: var(--text);
            outline: none;
            word-break: break-word;
          }
          .bl-compose-editor:empty::before {
            content: attr(data-placeholder);
            color: var(--text-muted);
            pointer-events: none;
          }
          .bl-compose-previews {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            padding: 0 1.25rem 0.5rem;
          }
          .bl-compose-preview {
            position: relative;
            display: inline-flex;
          }
          .bl-compose-preview img {
            width: 72px;
            height: 72px;
            object-fit: cover;
            border-radius: 8px;
            border: 1px solid var(--border);
          }
          .bl-compose-preview button {
            position: absolute;
            top: -6px;
            right: -6px;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: var(--bg);
            border: 1px solid var(--border);
            font-size: 0.6rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
            padding: 0;
          }
          .bl-compose-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.75rem 1.25rem;
            border-top: 1px solid var(--border);
          }
          .bl-compose-tools { display: flex; gap: 0.25rem; }
          .bl-compose-tool {
            background: none;
            border: none;
            color: var(--text-muted);
            padding: 0.35rem 0.5rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85rem;
            font-family: var(--font);
            transition: background 0.1s, color 0.1s;
          }
          .bl-compose-tool:hover { background: var(--bg); color: var(--text); }
          .bl-compose-counter { font-size: 0.72rem; color: var(--text-muted); }
          .bl-btn-follow {
            font-size: 0.72rem;
            font-weight: 600;
            padding: 0.2rem 0.65rem;
            border-radius: 99px;
            border: 1px solid var(--accent);
            background: transparent;
            color: var(--accent);
            cursor: pointer;
            font-family: var(--font);
            transition: all 0.15s;
            white-space: nowrap;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
          }
          .bl-btn-follow:hover { background: var(--accent); color: white; }
          .bl-btn-following {
            font-size: 0.72rem;
            font-weight: 600;
            padding: 0.2rem 0.65rem;
            border-radius: 99px;
            border: 1px solid var(--border);
            background: transparent;
            color: var(--text-muted);
            cursor: pointer;
            font-family: var(--font);
            transition: all 0.15s;
            white-space: nowrap;
            display: inline-flex;
            align-items: center;
          }
          .bl-btn-following:hover { border-color: var(--red); color: var(--red); }
          .bl-btn-following:hover::after { content: 'Unfollow'; }
          .bl-btn-following span { }
          .bl-btn-following:hover span { display: none; }

          /* ── Feed Column ──────────────────────────────────── */
          .bl-feed {
            max-width: var(--column-width);
            margin: 0 auto;
            padding: 2.5rem 1rem 0;
          }

          /* ── New Posts Banner ──────────────────────────────── */
          .bl-new-posts-header {
            position: fixed;
            top: 52px;
            left: 0;
            right: 0;
            z-index: 99;
            pointer-events: none;
          }
          .bl-new-posts {
            display: block;
            visibility: hidden;
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
            pointer-events: none;
          }
          .bl-new-posts.visible {
            visibility: visible;
            pointer-events: all;
          }
          .bl-new-posts:hover { background: rgba(99,102,241,0.18); }

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
            .bl-header-search { display: none; }
            .bl-feed { padding: 0 0.75rem; }
          }

          /* ── Stats Page ───────────────────────────────────── */
          .bl-stats {
            max-width: 1100px;
            margin: 0 auto;
            padding: 2rem 1.5rem 4rem;
          }
          .bl-stats-hero {
            margin-bottom: 2rem;
          }
          .bl-stats-hero h1 {
            font-size: 1.5rem;
            font-weight: 700;
            letter-spacing: -0.03em;
            margin-bottom: 0.25rem;
          }
          .bl-stats-updated {
            font-size: 0.75rem;
            color: var(--text-muted);
          }
          .bl-kpi-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
          }
          .bl-kpi-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 1.1rem 1.25rem;
          }
          .bl-kpi-value {
            font-size: 2rem;
            font-weight: 700;
            letter-spacing: -0.04em;
            color: var(--text);
            line-height: 1;
          }
          .bl-kpi-label {
            font-size: 0.75rem;
            color: var(--text-secondary);
            margin-top: 0.35rem;
            font-weight: 600;
          }
          .bl-kpi-sub {
            font-size: 0.68rem;
            color: var(--text-muted);
            margin-top: 0.15rem;
          }
          .bl-kpi-split {
            display: flex;
            gap: 0.75rem;
            margin-top: 0.4rem;
            padding-top: 0.4rem;
            border-top: 1px solid var(--border);
            font-size: 0.68rem;
          }
          .bl-kpi-split-wrap {
            flex-wrap: wrap;
            gap: 0.35rem 0.75rem;
          }
          .bl-kpi-native { color: var(--accent); }
          .bl-kpi-bridgy { color: var(--green); }
          .bl-kpi-verified { color: #22d3ee; }
          .bl-kpi-unchecked { color: rgba(255,255,255,0.35); }
          .bl-charts-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.25rem;
          }
          .bl-chart-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 1.25rem;
          }
          .bl-chart-wide {
            grid-column: 1 / -1;
          }
          .bl-chart-title {
            font-size: 0.85rem;
            font-weight: 700;
            margin-bottom: 0.15rem;
          }
          .bl-chart-sub {
            font-size: 0.7rem;
            color: var(--text-muted);
            margin-bottom: 0;
          }
          .bl-chart-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 0.75rem;
            margin-bottom: 1rem;
          }
          .bl-toggle {
            display: flex;
            border: 1px solid var(--border);
            border-radius: 6px;
            overflow: hidden;
            flex-shrink: 0;
          }
          .bl-toggle-btn {
            background: none;
            border: none;
            padding: 0.25rem 0.55rem;
            font-size: 0.65rem;
            font-family: var(--font);
            font-weight: 500;
            color: var(--text-muted);
            cursor: pointer;
            transition: all 0.15s;
            white-space: nowrap;
          }
          .bl-toggle-btn:not(:last-child) { border-right: 1px solid var(--border); }
          .bl-toggle-btn:hover { color: var(--text-primary); }
          .bl-toggle-btn.active {
            background: var(--accent);
            color: #fff;
          }
          .bl-heatmap { overflow-x: auto; }
          .bl-heatmap-inner { display: flex; flex-direction: column; gap: 3px; min-width: 600px; }
          .bl-hm-row { display: flex; gap: 3px; align-items: center; }
          .bl-hm-label { width: 30px; font-size: 0.68rem; color: var(--text-muted); flex-shrink: 0; text-align: right; padding-right: 4px; }
          .bl-hm-hlabel { width: 24px; font-size: 0.6rem; color: var(--text-muted); text-align: center; flex-shrink: 0; }
          .bl-hm-cell { width: 24px; height: 20px; border-radius: 3px; flex-shrink: 0; cursor: default; transition: opacity 0.15s; }
          .bl-hm-cell:hover { opacity: 0.75; }
          @media (max-width: 768px) {
            .bl-charts-grid { grid-template-columns: 1fr; }
            .bl-chart-wide { grid-column: 1; }
            .bl-kpi-grid { grid-template-columns: repeat(2, 1fr); }
            .bl-bf-grid { grid-template-columns: 1fr; }
          }
          .bl-bridgyfed-split {
            margin-bottom: 2rem;
          }
          .bl-bf-label {
            font-size: 0.72rem;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.07em;
            margin-bottom: 0.6rem;
          }
          .bl-bf-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1rem;
          }
          .bl-bf-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 0.9rem 1.1rem;
            display: flex;
            flex-direction: column;
            gap: 0.4rem;
          }
          .bl-bf-native { border-left: 3px solid #6366f1; }
          .bl-bf-bridgyfed { border-left: 3px solid #10b981; }
          .bl-bf-waa { border-left: 3px solid #f59e0b; }
          .bl-bf-title {
            font-size: 0.75rem;
            font-weight: 700;
            color: var(--text-secondary);
            margin-bottom: 0.25rem;
          }
          .bl-bf-row { display: flex; align-items: baseline; gap: 0.4rem; }
          .bl-bf-num {
            font-size: 1.4rem;
            font-weight: 700;
            letter-spacing: -0.03em;
            color: var(--text);
          }
          .bl-bf-sub {
            font-size: 0.7rem;
            color: var(--text-muted);
          }

          /* ── Feed two-column layout ─────────────────────────────── */
          .bl-feed-layout {
            display: grid;
            grid-template-columns: 1fr 264px;
            gap: 2rem;
            max-width: 920px;
            margin: 0 auto;
            align-items: start;
          }
          .bl-feed-main { min-width: 0; }
          .bl-sidebar {
            position: sticky;
            top: 5.5rem;
            display: flex;
            flex-direction: column;
            gap: 1.25rem;
          }

          /* ── Tabs ──────────────────────────────────────────────── */
          .bl-tabs {
            display: flex;
            gap: 0;
            border-bottom: 1px solid var(--border);
            margin-bottom: 0.75rem;
          }
          .bl-tab {
            padding: 0.6rem 1.1rem;
            font-size: 0.82rem;
            font-weight: 500;
            color: var(--text-muted);
            text-decoration: none;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
            transition: color 0.15s, border-color 0.15s;
          }
          .bl-tab:hover { color: var(--text); }
          .bl-tab-active {
            color: var(--accent);
            border-bottom-color: var(--accent);
          }

          /* ── Topic cluster pills ────────────────────────────────── */
          .bl-topic-wrap {
            position: relative;
          }
          .bl-topic-arrow {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            z-index: 2;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            border: 1px solid var(--border);
            background: var(--bg);
            color: var(--text-muted);
            font-size: 1.1rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.2s, background 0.15s, color 0.15s;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          }
          .bl-topic-arrow:hover { background: var(--surface); color: var(--text); }
          .bl-topic-arrow-left { left: -4px; }
          .bl-topic-arrow-right { right: -4px; }
          .bl-topic-bar {
            display: flex;
            flex-wrap: nowrap;
            gap: 0.4rem;
            padding: 0.5rem 0 0.75rem;
            overflow-x: auto;
            overflow-y: hidden;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            max-width: 100%;
            mask-image: linear-gradient(90deg, #000 0, #000 calc(100% - 2rem), transparent);
          }
          .bl-topic-bar::-webkit-scrollbar { display: none; }
          .bl-topic-pill {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            padding: 0.3rem 0.75rem;
            border-radius: 99px;
            border: 1px solid var(--border);
            background: var(--surface);
            color: var(--text-secondary);
            font-size: 0.75rem;
            font-weight: 500;
            white-space: nowrap;
            text-decoration: none;
            transition: all 0.2s;
            flex-shrink: 0;
          }
          .bl-topic-pill:hover {
            border-color: rgba(99,102,241,0.35);
            color: var(--accent);
            background: rgba(99,102,241,0.08);
            transform: translateY(-1px);
          }
          .bl-topic-count {
            font-size: 0.62rem;
            font-weight: 700;
            background: rgba(255,255,255,0.06);
            padding: 0.1rem 0.35rem;
            border-radius: 99px;
          }

          /* ── Leaderboard ──────────────────────────────────────── */
          .bl-leaderboard-header {
            margin-bottom: 1.25rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid var(--border);
          }
          .bl-leaderboard-header h1 {
            font-size: 1.3rem;
            font-weight: 700;
            letter-spacing: -0.03em;
            margin-bottom: 0.3rem;
          }
          .bl-leaderboard-header p {
            font-size: 0.78rem;
            color: var(--text-muted);
            line-height: 1.5;
            max-width: 600px;
          }
          .bl-lb-updated {
            font-size: 0.68rem;
            color: var(--text-muted);
          }
          .bl-lb-list {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          .bl-lb-row {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.65rem 0.75rem;
            border-radius: 10px;
            text-decoration: none;
            transition: background 0.15s;
          }
          .bl-lb-row:hover { background: var(--surface); }
          .bl-lb-rank {
            width: 32px;
            text-align: center;
            font-size: 0.78rem;
            font-weight: 700;
            color: var(--text-muted);
            flex-shrink: 0;
          }
          .bl-lb-rank-top { font-size: 1.1rem; }
          .bl-lb-avatar { flex-shrink: 0; }
          .bl-lb-avatar img {
            width: 38px;
            height: 38px;
            border-radius: 50%;
            object-fit: cover;
          }
          .bl-lb-avatar-ph {
            width: 38px;
            height: 38px;
            border-radius: 50%;
            background: var(--accent-dim);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--accent);
          }
          .bl-lb-info {
            flex: 1;
            min-width: 0;
          }
          .bl-lb-name {
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .bl-lb-handle {
            font-size: 0.7rem;
            color: var(--text-muted);
          }
          .bl-lb-signals {
            display: flex;
            flex-direction: column;
            gap: 3px;
            width: 100px;
            flex-shrink: 0;
          }
          .bl-lb-signal {
            display: flex;
            align-items: center;
            gap: 0.3rem;
          }
          .bl-lb-signal-label {
            font-size: 0.58rem;
            font-weight: 700;
            color: var(--text-muted);
            width: 16px;
            flex-shrink: 0;
          }
          .bl-signal-bar {
            flex: 1;
            height: 4px;
            background: rgba(255,255,255,0.06);
            border-radius: 2px;
            overflow: hidden;
          }
          .bl-signal-fill {
            height: 100%;
            border-radius: 2px;
            transition: width 0.3s ease;
          }
          .bl-lb-meta {
            display: flex;
            flex-direction: column;
            gap: 1px;
            flex-shrink: 0;
            text-align: right;
            min-width: 70px;
          }
          .bl-lb-stat {
            font-size: 0.65rem;
            color: var(--text-muted);
            white-space: nowrap;
          }
          .bl-lb-score {
            text-align: center;
            flex-shrink: 0;
            min-width: 48px;
          }
          .bl-lb-ais {
            font-size: 1rem;
            font-weight: 700;
            color: var(--accent);
            font-variant-numeric: tabular-nums;
          }
          .bl-lb-ais-label {
            font-size: 0.55rem;
            font-weight: 600;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }
          @media (max-width: 640px) {
            .bl-lb-signals { display: none; }
            .bl-lb-meta { display: none; }
          }

          /* ── Author stats grid ──────────────────────────────────── */
          .bl-author-stats {
            display: flex;
            gap: 0.75rem;
            margin-top: 0.5rem;
            flex-wrap: wrap;
          }
          .bl-author-stat {
            display: flex;
            align-items: baseline;
            gap: 0.3rem;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 0.4rem 0.7rem;
            font-size: 0.78rem;
          }
          .bl-author-stat strong {
            color: var(--text);
            font-weight: 700;
            font-variant-numeric: tabular-nums;
          }
          .bl-author-stat span {
            color: var(--text-muted);
            font-size: 0.7rem;
            font-weight: 500;
          }

          /* ── Sidebar sections ───────────────────────────────────── */
          .bl-sidebar-section {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 1rem;
          }
          .bl-sidebar-title {
            font-size: 0.72rem;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--text-muted);
            margin-bottom: 0.75rem;
          }

          /* Trending tags cloud */
          .bl-tag-cloud { display: flex; flex-wrap: wrap; gap: 0.35rem; }
          .bl-tag-chip {
            display: inline-flex;
            align-items: center;
            gap: 0.3rem;
            padding: 0.25rem 0.6rem;
            background: rgba(99,102,241,0.08);
            border: 1px solid rgba(99,102,241,0.18);
            border-radius: 99px;
            font-size: 0.73rem;
            color: var(--text-secondary);
            text-decoration: none;
            transition: background 0.15s, border-color 0.15s;
          }
          .bl-tag-chip:hover { background: rgba(99,102,241,0.16); border-color: rgba(99,102,241,0.35); color: var(--accent); }
          .bl-tag-chip span { font-size: 0.65rem; color: var(--text-muted); }

          /* Popular post items */
          .bl-popular-item {
            display: block;
            padding: 0.55rem 0;
            border-bottom: 1px solid var(--border);
            text-decoration: none;
          }
          .bl-popular-item:last-child { border-bottom: none; padding-bottom: 0; }
          .bl-popular-title {
            font-size: 0.8rem;
            font-weight: 500;
            color: var(--text);
            line-height: 1.35;
            margin-bottom: 0.2rem;
          }
          .bl-popular-item:hover .bl-popular-title { color: var(--accent); }
          .bl-popular-meta { font-size: 0.7rem; color: var(--text-muted); }

          /* ── Like / Share buttons ───────────────────────────────── */
          .bl-post-actions {
            display: flex;
            gap: 0.4rem;
            align-items: center;
            margin-right: 0.5rem;
          }
          .bl-action-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.2rem;
            padding: 0.2rem 0.55rem;
            background: none;
            border: 1px solid var(--border);
            border-radius: 99px;
            font-size: 0.75rem;
            color: var(--text-muted);
            cursor: pointer;
            transition: all 0.15s;
            white-space: nowrap;
          }
          .bl-action-btn:hover { border-color: var(--border-hover); color: var(--text); }
          .bl-like-btn.liked { color: #e11d48; border-color: rgba(225,29,72,0.35); background: rgba(225,29,72,0.06); }
          .bl-like-btn.liked:hover { background: rgba(225,29,72,0.12); }
          .bl-action-static { border: none; padding-left: 0; cursor: default; }
          .bl-action-count { min-width: 0.5ch; }

          /* ── Responsive sidebar ─────────────────────────────────── */
          @media (max-width: 720px) {
            .bl-feed-layout { grid-template-columns: 1fr; }
            .bl-sidebar { display: none; }
          }

          /* ── App shell (three-column) ──────────────────────────── */
          .bl-app-shell {
            display: flex;
            min-height: calc(100vh - 3.5rem);
            max-width: 1240px;
            margin: 0 auto;
          }
          .bl-left-nav {
            width: 196px;
            flex-shrink: 0;
            border-right: 1px solid var(--border);
            position: sticky;
            top: 3.5rem;
            height: calc(100vh - 3.5rem);
            overflow-y: auto;
            padding: 1.25rem 0.75rem;
            display: flex;
            flex-direction: column;
          }
          .bl-nav-items {
            display: flex;
            flex-direction: column;
            gap: 0.15rem;
            flex: 1;
          }
          .bl-nav-item {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.6rem 0.85rem;
            border-radius: 10px;
            color: var(--text-muted);
            text-decoration: none;
            font-size: 0.88rem;
            font-weight: 500;
            transition: all 0.15s;
          }
          .bl-nav-item svg {
            width: 18px;
            height: 18px;
            flex-shrink: 0;
          }
          .bl-nav-item:hover {
            background: var(--surface);
            color: var(--text);
          }
          .bl-nav-active {
            background: rgba(99,102,241,0.1);
            color: var(--accent);
            font-weight: 600;
          }
          .bl-nav-footer {
            padding-top: 1rem;
            border-top: 1px solid var(--border);
          }
          .bl-nav-write-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            width: 100%;
            padding: 0.6rem 1rem;
            background: var(--accent);
            color: var(--bg);
            border: none;
            border-radius: 99px;
            font-size: 0.85rem;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            text-decoration: none;
            transition: opacity 0.15s;
          }
          .bl-nav-write-btn:hover { opacity: 0.85; }
          .bl-content {
            flex: 1;
            min-width: 0;
            padding: 1.5rem 1.5rem 3rem;
          }

          /* Remove the bl-feed centering when inside the app shell */
          .bl-content .bl-feed {
            max-width: 660px;
            margin: 0;
            padding-top: 0;
          }
          .bl-content .bl-feed-layout {
            max-width: 860px;
            margin: 0;
          }

          /* ── Left nav responsive ────────────────────────────────── */
          @media (max-width: 900px) {
            .bl-left-nav { width: 56px; padding: 1rem 0.4rem; }
            .bl-nav-item { padding: 0.6rem; justify-content: center; gap: 0; }
            .bl-nav-item svg { width: 20px; height: 20px; }
            .bl-nav-item span, .bl-nav-item:not(:has(svg)) { font-size: 0; }
            .bl-nav-write-btn { padding: 0.6rem; font-size: 0; }
            .bl-nav-write-btn svg { width: 18px; height: 18px; }
            .bl-content { padding: 1rem 0.75rem; }
          }
          @media (max-width: 600px) {
            .bl-left-nav { display: none; }
            .bl-content { padding: 0.75rem; }
          }
        </style>
      </head>
      <body>
        <header class="bl-header">
          <div class="bl-header-inner">
            <a href="/" class="bl-logo">blogs<span>.social</span></a>
            <form action="/search" method="GET" class="bl-header-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" name="q" placeholder="Search posts…" autocomplete="off" />
            </form>
            <div class="bl-header-spacer"></div>
            <div class="bl-header-actions">
              ${session
      ? html`
              <div class="bl-user-menu">
                ${session.avatar
                  ? html`<img src="${session.avatar}" alt="" />`
                  : html`<div class="bl-user-placeholder">${(session.displayName || session.handle || '?')[0].toUpperCase()}</div>`
                }
                <div class="bl-user-dropdown">
                  <div class="bl-user-dropdown-header">
                    <div class="bl-user-dropdown-name">${session.displayName || session.handle}</div>
                    <div class="bl-user-dropdown-handle">@${session.handle}</div>
                  </div>
                  <a href="/author/${session.did}">Profile</a>
                  <a href="/subscriptions">Subscriptions</a>
                  <a href="/stats">Stats</a>
                  <a href="/auth/logout" class="bl-signout-link">Sign out</a>
                </div>
              </div>
              `
      : html`<a href="/auth/login" class="bl-btn bl-btn-primary">Sign in</a>`
    }
            </div>
          </div>
        </header>

        ${session ? html`
        <!-- Compose Modal -->
        <div id="composeOverlay" class="bl-compose-overlay" onclick="closeComposeOutside(event)">
          <div class="bl-compose-modal" role="dialog" aria-modal="true" aria-label="Write a post">
            <div class="bl-compose-header">
              <span class="bl-compose-title">Write a post</span>
              <button class="bl-compose-close" onclick="closeCompose()" aria-label="Close">✕</button>
            </div>
            <form id="composeForm" action="/compose" method="POST" enctype="multipart/form-data" onsubmit="submitCompose(event)">
              <input
                name="title"
                type="text"
                placeholder="Title (optional)"
                class="bl-compose-title-input"
                autocomplete="off"
              />
              <div
                id="composeEditor"
                class="bl-compose-editor"
                contenteditable="true"
                data-placeholder="What's on your mind?"
                oninput="updateCounter()"
              ></div>
              <!-- hidden textarea mirrors editor content for form submission -->
              <textarea name="content" id="composeContent" style="display:none;"></textarea>
              <!-- Image previews -->
              <div id="imagePreviews" class="bl-compose-previews"></div>
              <div class="bl-compose-footer">
                <div class="bl-compose-tools">
                  <button type="button" onclick="execFmt('bold')" class="bl-compose-tool" title="Bold"><b>B</b></button>
                  <button type="button" onclick="execFmt('italic')" class="bl-compose-tool" title="Italic"><i>I</i></button>
                  <button type="button" onclick="insertLink()" class="bl-compose-tool" title="Link">🔗</button>
                  <label class="bl-compose-tool" title="Add image" style="cursor:pointer;">
                    🖼
                    <input type="file" name="images" id="imageInput" accept="image/*" multiple style="display:none;" onchange="previewImages(event)" />
                  </label>
                </div>
                <div style="display:flex;align-items:center;gap:0.75rem;">
                  <span id="charCounter" class="bl-compose-counter">0</span>
                  <button type="submit" class="bl-btn bl-btn-primary" id="composeSubmit">Publish</button>
                </div>
              </div>
            </form>
          </div>
        </div>
        ` : ''}

        <div class="bl-app-shell">
          <nav class="bl-left-nav">
            <div class="bl-nav-items">
              <a href="/" class="bl-nav-item ${navPage === 'home' ? 'bl-nav-active' : ''}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                Home
              </a>
              <a href="/leaderboard" class="bl-nav-item ${navPage === 'leaderboard' ? 'bl-nav-active' : ''}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/><circle cx="12" cy="7" r="1" fill="currentColor"/><circle cx="18" cy="2" r="1" fill="currentColor"/><circle cx="6" cy="14" r="1" fill="currentColor"/></svg>
                Top Authors
              </a>
              <a href="/stats" class="bl-nav-item ${navPage === 'stats' ? 'bl-nav-active' : ''}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                Stats
              </a>
              ${session ? raw(`
              <a href="/author/${session.did}" class="bl-nav-item ${navPage === 'profile' ? 'bl-nav-active' : ''}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                Profile
              </a>
              <a href="/?view=following" class="bl-nav-item ${navPage === 'following' ? 'bl-nav-active' : ''}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                Following
              </a>
              <a href="/subscriptions" class="bl-nav-item ${navPage === 'subscriptions' ? 'bl-nav-active' : ''}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                Subscriptions
              </a>
              `) : ''}
            </div>
            ${session ? raw(`
            <div class="bl-nav-footer">
              <button onclick="openCompose()" class="bl-nav-write-btn">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Write
              </button>
            </div>
            `) : ''}
          </nav>
          <div class="bl-content">
            ${children}
          </div>
        </div>

        <script src="/js/blogs.js"></script>
      </body>
    </html>
  `;
}

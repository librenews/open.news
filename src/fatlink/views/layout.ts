import { html } from 'hono/html';

interface LayoutProps {
  title: string;
  session: { did: string; handle: string; display_name: string | null; avatar: string | null } | null;
  children: any;
  wide?: boolean;
}

export function Layout({ title, session, children, wide }: LayoutProps) {
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <meta name="description" content="fat.link — create interactive pages with AI" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --font: 'Inter', -apple-system, system-ui, sans-serif;
      --mono: 'JetBrains Mono', monospace;
      --bg: #0c0c0f;
      --bg-card: #16161a;
      --bg-hover: #1e1e24;
      --bg-input: #111114;
      --border: rgba(255,255,255,0.08);
      --border-focus: rgba(124,92,252,0.5);
      --text: #e8e8ec;
      --text-secondary: #8b8b9e;
      --text-muted: #55556a;
      --accent: #7c5cfc;
      --accent-hover: #9178ff;
      --accent-subtle: rgba(124,92,252,0.12);
      --green: #34d399;
      --red: #f43f5e;
      --radius: 12px;
      --radius-sm: 8px;
    }

    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }

    a { color: var(--accent); text-decoration: none; }
    a:hover { color: var(--accent-hover); }

    .nav {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.75rem 1.5rem;
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(12px);
      position: sticky; top: 0; z-index: 100;
      background: rgba(12,12,15,0.85);
    }
    .nav-brand { font-size: 1.1rem; font-weight: 800; color: var(--text); letter-spacing: -0.03em; }
    .nav-brand span { color: var(--accent); }
    .nav-user { display: flex; align-items: center; gap: 0.6rem; font-size: 0.85rem; color: var(--text-secondary); }
    .nav-avatar { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }

    .btn {
      display: inline-flex; align-items: center; gap: 0.4rem;
      padding: 0.5rem 1rem; border-radius: var(--radius-sm);
      font-family: var(--font); font-size: 0.82rem; font-weight: 600;
      border: none; cursor: pointer; transition: all 0.15s ease;
    }
    .btn-primary { background: var(--accent); color: white; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--border); }
    .btn-ghost:hover { background: var(--bg-hover); color: var(--text); border-color: rgba(255,255,255,0.15); }
    .btn-danger { background: var(--red); color: white; }
    .btn-danger:hover { opacity: 0.9; }

    .input {
      width: 100%; padding: 0.55rem 0.85rem;
      background: var(--bg-input); border: 1px solid var(--border);
      border-radius: var(--radius-sm); color: var(--text);
      font-family: var(--font); font-size: 0.88rem;
      outline: none; transition: border-color 0.15s;
    }
    .input:focus { border-color: var(--accent); }
    .input::placeholder { color: var(--text-muted); }
    textarea.input { resize: vertical; min-height: 60px; }

    .container { max-width: ${wide ? '1200px' : '640px'}; margin: 0 auto; padding: 2rem 1.25rem; }

    .card {
      background: var(--bg-card); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 1rem 1.25rem;
      transition: border-color 0.15s;
    }
    .card:hover { border-color: rgba(255,255,255,0.12); }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .fade-in { animation: fadeIn 0.3s ease forwards; }

    @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
    .loading-dot { animation: pulse 1.4s infinite ease-in-out; }
  </style>
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-brand">fat<span>.link</span></a>
    ${session
      ? html`<div class="nav-user">
          ${session.avatar
            ? html`<img src="${session.avatar}" alt="" class="nav-avatar" />`
            : ''}
          <span>@${session.handle}</span>
          <a href="/auth/logout" class="btn btn-ghost" style="padding: 0.3rem 0.7rem; font-size: 0.78rem;">Sign out</a>
        </div>`
      : html`<a href="/" class="btn btn-primary" style="padding: 0.35rem 0.8rem; font-size: 0.78rem;">Sign in</a>`
    }
  </nav>
  <main class="container">
    ${children}
  </main>
</body>
</html>`;
}

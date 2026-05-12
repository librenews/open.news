/** @jsxImportSource hono/jsx */

export function NotFoundPage() {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>404 — Longform</title>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Merriweather:ital,wght@0,300;0,400;0,700;1,300;1,400&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{__html: `
          :root {
            --bg: #ffffff;
            --bg-secondary: #f8f9fa;
            --text-main: #1a1a1a;
            --text-secondary: #6b7280;
            --text-muted: #9ca3af;
            --border: #e5e7eb;
            --accent: #111827;
            --font-body: 'Merriweather', Georgia, serif;
            --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --bg: #0f0f0f;
              --bg-secondary: #1a1a1a;
              --text-main: rgba(255, 255, 255, 0.92);
              --text-secondary: rgba(255, 255, 255, 0.6);
              --text-muted: rgba(255, 255, 255, 0.4);
              --border: rgba(255, 255, 255, 0.08);
              --accent: #ffffff;
            }
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: var(--font-sans);
            background: var(--bg);
            color: var(--text-main);
            -webkit-font-smoothing: antialiased;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
          }

          /* Top header */
          .top-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.75rem 2rem;
            border-bottom: 1px solid var(--border);
          }
          .top-header-logo {
            font-family: var(--font-body);
            font-weight: 700;
            font-size: 1.2rem;
            color: var(--text-main);
            text-decoration: none;
            display: flex;
            align-items: center;
          }
          .top-header-logo img { height: 44px; width: auto; }
          .top-header-links {
            display: flex;
            gap: 1.25rem;
            align-items: center;
          }
          .top-header-links a {
            color: var(--text-secondary);
            text-decoration: none;
            font-size: 0.85rem;
            font-weight: 500;
            transition: color 0.15s;
          }
          .top-header-links a:hover { color: var(--text-main); }

          /* 404 content */
          .not-found {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 4rem 2rem;
          }
          .not-found-code {
            font-family: var(--font-body);
            font-size: 8rem;
            font-weight: 700;
            letter-spacing: -0.04em;
            line-height: 1;
            color: var(--text-main);
            opacity: 0.08;
            position: absolute;
            user-select: none;
          }
          .not-found-content {
            position: relative;
            z-index: 1;
          }
          .not-found h1 {
            font-family: var(--font-body);
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 0.75rem;
          }
          .not-found-joke {
            font-family: var(--font-body);
            font-size: 0.95rem;
            font-weight: 300;
            font-style: italic;
            color: var(--text-secondary);
            margin-bottom: 2rem;
            line-height: 1.6;
          }
          .not-found-links {
            display: flex;
            gap: 1rem;
            flex-wrap: wrap;
            justify-content: center;
          }
          .not-found-link {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.55rem 1.25rem;
            border-radius: 99px;
            font-size: 0.85rem;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.15s;
          }
          .not-found-link-primary {
            background: var(--accent);
            color: var(--bg);
          }
          .not-found-link-primary:hover {
            opacity: 0.85;
          }
          .not-found-link-secondary {
            border: 1px solid var(--border);
            color: var(--text-secondary);
          }
          .not-found-link-secondary:hover {
            background: var(--bg-secondary);
            color: var(--text-main);
            border-color: var(--text-muted);
          }
          .not-found-link svg {
            width: 16px;
            height: 16px;
          }
        `}} />
      </head>
      <body>
        <header class="top-header">
          <a href="/" class="top-header-logo">
            <img src="/logo.png" alt="Longform" onerror="this.outerHTML='<span>Longform</span>'" />
          </a>
          <div class="top-header-links">
            <a href="/">Home</a>
            <a href="/search">Search</a>
          </div>
        </header>

        <div class="not-found">
          <div class="not-found-code">404</div>
          <div class="not-found-content">
            <h1>Page Not Found</h1>
            <p class="not-found-joke">
              Decentralization? More like disintegration.
            </p>
            <div class="not-found-links">
              <a href="/" class="not-found-link not-found-link-primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                Go Home
              </a>
              <a href="/search" class="not-found-link not-found-link-secondary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Search Articles
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}

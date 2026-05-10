/** @jsxImportSource hono/jsx */
import { BASE_STYLES, HEADER_STYLES, NAV_STYLES, FontLinks, TopHeader, LeftNav } from './partials.js';

const PAGE_STYLES = `
.center-content { flex: 1; min-width: 0; border-right: 1px solid var(--border); border-left: 1px solid var(--border); }
.notfound-container { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 50vh; text-align: center; padding: 2rem; }
.notfound-code { font-size: 6rem; font-weight: 800; color: var(--text-muted); line-height: 1; margin-bottom: 1rem; font-family: var(--font-sans); }
.notfound-title { font-family: var(--font-body); font-size: 1.5rem; font-weight: 700; margin-bottom: 0.75rem; }
.notfound-desc { color: var(--text-secondary); font-size: 0.95rem; margin-bottom: 2rem; max-width: 400px; line-height: 1.6; }
.notfound-btn { display: inline-block; padding: 0.6rem 1.5rem; background: var(--accent); color: var(--bg); border-radius: 99px; text-decoration: none; font-weight: 600; font-size: 0.85rem; transition: background 0.15s; }
.notfound-btn:hover { background: var(--accent-hover); }
`;

export function NotFoundPage() {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Not Found — Centipedia</title>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <FontLinks />
        <style dangerouslySetInnerHTML={{__html: BASE_STYLES + HEADER_STYLES + NAV_STYLES + PAGE_STYLES}} />
      </head>
      <body>
        <TopHeader />

        <div class="app-shell">
          <LeftNav active="" />

          <main class="center-content">
            <div class="notfound-container">
              <div class="notfound-code">404</div>
              <h1 class="notfound-title">Page not found</h1>
              <p class="notfound-desc">The article or page you're looking for doesn't exist yet. Maybe you should submit a citation to get it started.</p>
              <a href="/" class="notfound-btn">Back to Home</a>
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}

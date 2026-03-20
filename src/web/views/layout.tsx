/** @jsxImportSource hono/jsx */

export const Layout = ({
  title,
  user,
  children,
}: {
  title?: string;
  user?: { handle: string } | null;
  children?: unknown;
}) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title ? `${title} — open.news` : 'open.news'}</title>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
      />
      <style>{`
        body { max-width: 860px; margin: 0 auto; }
        nav { display: flex; justify-content: space-between; align-items: center; }
        .article-card { border-bottom: 1px solid var(--pico-muted-border-color); padding: 1rem 0; }
        .article-card:last-child { border-bottom: none; }
        .article-meta { font-size: 0.85rem; color: var(--pico-muted-color); margin: 0.25rem 0 0; }
        .article-image { float: right; margin-left: 1rem; width: 100px; height: 70px; object-fit: cover; border-radius: 4px; }
        .clearfix::after { content: ''; display: table; clear: both; }
      `}</style>
    </head>
    <body>
      <main class="container">
        <nav>
          <strong>
            <a href="/" style="text-decoration:none">
              open.news
            </a>
          </strong>
          {user ? (
            <span style="display:flex;gap:0.75rem;align-items:center">
              <a href="/admin">Admin</a>
              <form action="/oauth/logout" method="post" style="margin:0">
                <button type="submit" class="outline secondary" style="margin:0">
                  Sign out @{user.handle}
                </button>
              </form>
            </span>
          ) : (
            <a href="/login" role="button">
              Sign in
            </a>
          )}
        </nav>
        {children}
      </main>
    </body>
  </html>
);

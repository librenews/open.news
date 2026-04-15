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
      <script dangerouslySetInnerHTML={{
        __html: `if ('serviceWorker' in navigator) { navigator.serviceWorker.getRegistrations().then(function(regs) { for(let reg of regs) reg.unregister(); }); }`
      }} />
      <title>{title ? `${title} — open.news` : 'open.news'}</title>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
      />
      <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
      <style>{`
        body { max-width: 860px; margin: 0 auto; padding: 0 1rem; }
        nav { display: flex; justify-content: space-between; align-items: center; padding: 1rem 0; }
        .article-card { border-bottom: 1px solid var(--pico-muted-border-color); padding: 1rem 0; }
        .article-card:last-child { border-bottom: none; }
        .article-meta { font-size: 0.85rem; color: var(--pico-muted-color); margin: 0.25rem 0 0; }
        .article-image { float: right; margin-left: 1rem; width: 100px; height: 70px; object-fit: cover; border-radius: 4px; }
        .clearfix::after { content: ''; display: table; clear: both; }
        .shared-by { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.4rem; font-size: 0.82rem; color: var(--pico-muted-color); flex-wrap: wrap; }
        .shared-first { display: flex; align-items: center; gap: 0.3rem; }
        .shared-first img { border-radius: 50%; vertical-align: middle; }
        .shared-first a, .shared-first span { color: var(--pico-muted-color); text-decoration: none; }
        .shared-first a:hover { text-decoration: underline; }
        .shared-rest { display: flex; align-items: center; gap: 0.2rem; }
        .shared-avatar img { border-radius: 50%; display: block; }
        .shared-avatar a { display: block; line-height: 0; }
        .shared-overflow { font-size: 0.78rem; color: var(--pico-muted-color); }
        #chat-messages { min-height: 60vh; max-height: 70vh; overflow-y: auto;
                         display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem 0; }
        .msg-user { align-self: flex-end; background: var(--pico-primary-background);
                    color: var(--pico-primary-inverse); border-radius: 12px;
                    padding: 0.6rem 1rem; max-width: 75%; }
        .msg-assistant { align-self: flex-start; max-width: 85%; }
        .msg-assistant .text { background: var(--pico-card-background-color);
                                border-radius: 12px; padding: 0.6rem 1rem; }
        .msg-streaming .text { display: none; }
        .typing-indicator { display: flex; align-items: center; gap: 5px;
                             padding: 0.8rem 1.2rem; background: var(--pico-card-background-color);
                             border-radius: 12px; width: fit-content; }
        .typing-dot { width: 8px; height: 8px; border-radius: 50%;
                       background: var(--pico-muted-color); animation: typingBounce 1.4s ease-in-out infinite; }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
                                   30% { transform: translateY(-6px); opacity: 1; } }
        .msg-reveal .text { animation: fadeIn 0.25s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .article-card-block { border: 1px solid var(--pico-muted-border-color);
                               border-radius: 8px; padding: 0.75rem; margin: 0.5rem 0;
                               display: flex; gap: 0.75rem; }
        .article-card-block img { width: 80px; height: 56px; object-fit: cover;
                                   border-radius: 4px; flex-shrink: 0; }
        .article-card-block .meta { font-size: 0.8rem; color: var(--pico-muted-color); }
        .suggestions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
        .suggestion-chip { font-size: 0.85rem; padding: 0.3rem 0.75rem;
                            border-radius: 999px; border: 1px solid var(--pico-primary);
                            color: var(--pico-primary); cursor: pointer; background: none; }
        .suggestion-chip:hover { background: var(--pico-primary-background);
                                  color: var(--pico-primary-inverse); }
        .pref-confirm { background: var(--pico-ins-color); border-radius: 8px;
                        padding: 0.6rem 1rem; font-size: 0.9rem; }
        #chat-input-row { display: flex; gap: 0.5rem; padding: 1rem 0; position: sticky;
                          bottom: 0; background: var(--pico-background-color); }
        #chat-input-row input { flex: 1; margin: 0; }
        #chat-input-row button { margin: 0; width: auto; }
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
              <a href="/chat">Chat</a>
              <a href="/feed">Feed</a>
              <a href="/admin">Admin</a>
              <form action="/oauth/logout" method="post" style="margin:0">
                <button type="submit" class="outline secondary" style="margin:0;padding:0.3rem 0.75rem;font-size:0.85rem">
                  @{user.handle}
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
      <footer class="container" style="text-align: center; margin-top: 2rem; padding: 1rem 0; font-size: 0.85rem; color: var(--pico-muted-color);">
        <p>
          <a href="/privacy" style="color: inherit; text-decoration: underline;">Privacy Policy</a> | <a href="/tos" style="color: inherit; text-decoration: underline;">Terms of Service</a> | Contact: <a href="mailto:app@track.social" style="color: inherit; text-decoration: underline;">app@track.social</a>
        </p>
      </footer>
    </body>
  </html>
);

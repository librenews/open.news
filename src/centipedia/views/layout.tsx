import { html } from 'hono/html';

export function Layout({ title, children, profile, headerAction, og }: { title: string; children: any; profile?: { displayName: string, avatar: string, handle: string }; headerAction?: any; og?: { title: string; description: string; url: string; image?: string } }) {
  return html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        ${og ? html`
          <meta property="og:title" content="${og.title}" />
          <meta property="og:description" content="${og.description}" />
          ${og.image ? html`<meta property="og:image" content="${og.image}" />` : ''}
          <meta property="og:url" content="${og.url}" />
          <meta property="og:type" content="article" />
          <meta name="twitter:card" content="summary_large_image" />
        ` : ''}
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,300;0,400;0,700;1,300;1,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
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
            --container-width: 680px;
            --header-height: 57px;
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
          html { overflow-y: scroll; }
          body {
            background: var(--bg);
            color: var(--text-main);
            font-family: var(--font-body);
            -webkit-font-smoothing: antialiased;
          }

          .container {
            width: 100%;
            max-width: var(--container-width);
            margin: 0 auto;
            padding: 2rem 20px 4rem 20px;
          }

          /* Shared header — matches partials.tsx */
          .nav-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-family: var(--font-sans);
            font-size: 14px;
            font-weight: 500;
            padding: 1rem 2rem;
            border-bottom: 1px solid var(--border);
            height: var(--header-height);
            position: sticky;
            top: 0;
            background: var(--bg);
            z-index: 20;
          }
          
          .nav-links {
            display: flex;
            gap: 1.5rem;
            align-items: center;
          }
          
          .nav-header a {
            color: var(--text-muted);
            text-decoration: none;
            transition: color 0.2s;
          }
          
          .nav-header a:hover {
            color: var(--text-main);
          }

          .user-dropdown {
            position: relative;
            display: inline-block;
          }
          .dropdown-content {
            display: none;
            position: absolute;
            right: 0;
            top: 100%;
            background-color: var(--bg);
            min-width: 180px;
            box-shadow: 0px 8px 24px rgba(0,0,0,0.12);
            border-radius: 10px;
            z-index: 100;
            overflow: hidden;
            border: 1px solid var(--border);
          }
          .dropdown-content::before {
            content: '';
            position: absolute;
            top: -8px;
            left: 0;
            right: 0;
            height: 8px;
          }
          .user-dropdown:hover .dropdown-content {
            display: block;
          }
          .dropdown-content a:hover {
            background-color: var(--bg-secondary);
          }
          @media (prefers-color-scheme: dark) {
            .dropdown-content {
               box-shadow: 0px 8px 24px rgba(0,0,0,0.5);
            }
          }

          /* Tiptap overrides */
          .ProseMirror {
            outline: none;
            line-height: 2;
            font-size: 20px;
            font-weight: 300;
          }

          .ProseMirror p {
             margin-bottom: 2rem;
          }

          .ProseMirror h1 {
            font-family: var(--font-sans);
            font-size: 42px;
            font-weight: 700;
            line-height: 1.25;
            letter-spacing: -0.02em;
            margin-top: 3rem;
            margin-bottom: 1.5rem;
          }

          .ProseMirror[contenteditable="true"].ProseMirror-focused {
             outline: none;
          }
          
          .ProseMirror p.is-editor-empty:first-child::before {
            color: var(--text-muted);
            content: attr(data-placeholder);
            float: left;
            height: 0;
            pointer-events: none;
          }
        </style>
      </head>
      <body>
          ${title.includes('Sign in') ? '' : html`
            <nav class="nav-header">
              <a href="/" style="display: flex; align-items: center; text-decoration: none;">
                <img src="/logo.jpg" alt="Centipedia" style="height: 40px; width: auto;" onerror="this.outerHTML='<span style=\\'font-family: var(--font-body); font-weight: 700; font-size: 22px; color: var(--text-main); letter-spacing: -0.03em;\\'>Centipedia</span>'" />
              </a>
              
              ${profile ? html`
              <div class="nav-links">
                <a href="/new" title="New Draft" style="display: flex; align-items: center;">
                  <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                </a>
                <a href="/posts">My Work</a>
              </div>
              ` : ''}
              
              <div style="display: flex; align-items: center; gap: 1rem;">
                ${headerAction ? headerAction : ''}
                
                ${profile ? html`
                  <div class="user-dropdown">
                    ${profile.avatar 
                      ? html`<img src="${profile.avatar}" alt="${profile.handle}" style="width: 30px; height: 30px; border-radius: 50%; object-fit: cover; cursor: pointer; display: block;" />` 
                      : html`<div style="width: 30px; height: 30px; border-radius: 50%; background: var(--text-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--bg); font-size: 0.75rem; font-weight: 700;">${profile.displayName.charAt(0).toUpperCase()}</div>`
                    }
                    <div class="dropdown-content">
                      <div style="padding: 0.6rem 1rem; border-bottom: 1px solid var(--border);">
                        <span style="display: block; font-weight: 600; font-size: 0.85rem; color: var(--text-main);">${profile.displayName}</span>
                        <span style="display: block; font-size: 0.7rem; color: var(--text-muted);">@${profile.handle}</span>
                      </div>
                      <a href="/logout" style="display: block; padding: 0.6rem 1rem; font-size: 0.85rem; color: #d32f2f !important;">Sign out</a>
                    </div>
                  </div>
                ` : ''}
              </div>
            </nav>
          `}
          <div class="container">
            ${children}
          </div>
      </body>
    </html>
  `;
}

/** @jsxImportSource hono/jsx */

export function HoldingPage() {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>open.news — Open social web services</title>
        <meta name="description" content="Publishing and discovery tools for the open social web, powered by the AT Protocol." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700;800&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{__html: `
          :root {
            --bg: #07070c;
            --bg-card: rgba(255,255,255,0.03);
            --border: rgba(255,255,255,0.07);
            --border-hover: rgba(255,255,255,0.14);
            --text: #e4e4ec;
            --text-muted: #6b6b85;
            --accent: #6366f1;
            --accent-2: #8b5cf6;
            --accent-3: #06b6d4;
            --font: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            --font-display: 'Outfit', 'Inter', sans-serif;
          }
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: var(--font);
            background: var(--bg);
            color: var(--text);
            -webkit-font-smoothing: antialiased;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
          }

          .hero {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 4rem 1.5rem;
            position: relative;
            overflow: hidden;
          }
          .hero::before {
            content: '';
            position: absolute;
            top: -40%;
            left: 50%;
            transform: translateX(-50%);
            width: 600px;
            height: 600px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%);
            pointer-events: none;
          }

          .logo {
            font-family: var(--font-display);
            font-size: 3.5rem;
            font-weight: 800;
            letter-spacing: -0.04em;
            margin-bottom: 0.75rem;
            position: relative;
          }
          .logo .dot {
            background: linear-gradient(135deg, #6366f1, #8b5cf6, #06b6d4);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
          }
          .tagline {
            font-size: 1.15rem;
            color: var(--text-muted);
            max-width: 480px;
            line-height: 1.6;
            margin-bottom: 3rem;
          }

          .services {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.25rem;
            max-width: 960px;
            width: 100%;
            position: relative;
          }

          .service-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 1.75rem;
            text-decoration: none;
            color: inherit;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            display: flex;
            flex-direction: column;
            gap: 0.6rem;
          }
          .service-card:hover {
            border-color: var(--border-hover);
            transform: translateY(-3px);
            box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 20px rgba(99,102,241,0.08);
          }
          .service-icon {
            font-size: 2rem;
            margin-bottom: 0.25rem;
          }
          .service-name {
            font-family: var(--font-display);
            font-size: 1.25rem;
            font-weight: 700;
            letter-spacing: -0.02em;
          }
          .service-desc {
            font-size: 0.9rem;
            color: var(--text-muted);
            line-height: 1.5;
          }
          .service-link {
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--accent);
            margin-top: auto;
            padding-top: 0.5rem;
          }

          footer {
            text-align: center;
            padding: 2rem 1.5rem;
            font-size: 0.8rem;
            color: var(--text-muted);
            border-top: 1px solid var(--border);
          }
          footer a { color: var(--text-muted); text-decoration: none; }
          footer a:hover { color: var(--text); }
          .footer-links { display: flex; justify-content: center; gap: 1.5rem; margin-top: 0.5rem; }

          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .fade { animation: fadeInUp 0.5s cubic-bezier(0.16,1,0.3,1) both; }
          .fade-d1 { animation-delay: 0.1s; }
          .fade-d2 { animation-delay: 0.2s; }
          .fade-d3 { animation-delay: 0.3s; }

          @media (max-width: 640px) {
            .logo { font-size: 2.5rem; }
            .services { grid-template-columns: 1fr; }
          }
        `}} />
      </head>
      <body>
        <main class="hero">
          <h1 class="logo fade">open<span class="dot">.</span>news</h1>
          <p class="tagline fade fade-d1">
            Publishing and discovery tools for the open social web, powered by the AT&nbsp;Protocol.
          </p>

          <div class="services">
            <a href="https://blogs.social" class="service-card fade fade-d1">
              <div class="service-icon">📝</div>
              <div class="service-name">blogs.social</div>
              <div class="service-desc">
                Discover verified articles and publications from across the AT Protocol network. Trending topics, author profiles, and real-time updates.
              </div>
              <div class="service-link">Explore publications →</div>
            </a>

            <a href="https://track.social" class="service-card fade fade-d2">
              <div class="service-icon">🎯</div>
              <div class="service-name">track.social</div>
              <div class="service-desc">
                Create semantic topic monitors that surface relevant conversations from the Bluesky firehose in real time.
              </div>
              <div class="service-link">Start tracking →</div>
            </a>

            <a href="https://feeds.social" class="service-card fade fade-d3">
              <div class="service-icon">📡</div>
              <div class="service-name">feeds.social</div>
              <div class="service-desc">
                Build and publish custom Bluesky feeds powered by your topic monitors. One-click publishing to the network.
              </div>
              <div class="service-link">Create a feed →</div>
            </a>
          </div>
        </main>

        <footer>
          <p>Built on the AT Protocol open network.</p>
          <div class="footer-links">
            <a href="/privacy">Privacy</a>
            <a href="/tos">Terms</a>
            <a href="mailto:app@track.social">Contact</a>
          </div>
        </footer>
      </body>
    </html>
  );
}

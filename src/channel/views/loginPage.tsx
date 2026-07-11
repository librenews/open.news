import { html } from 'hono/html';

export function OnnLoginPage({ returnTo }: { returnTo?: string }) {
  return html`
    <!DOCTYPE html>
    <html lang="en" class="h-full">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Sign In — ONN</title>
        <meta name="description" content="Sign in to ONN — The Open News Network. Powered by AT Protocol." />
        <link rel="icon" type="image/svg+xml" href="/static/onn-favicon.svg" />
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html, body { height: 100%; }
          body {
            font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: #020617;
            color: #f8fafc;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
          }
          .title-font { font-family: 'Outfit', sans-serif; }

          /* Background radial glow */
          body::before {
            content: '';
            position: fixed;
            top: -40%;
            left: 50%;
            transform: translateX(-50%);
            width: 800px;
            height: 800px;
            background: radial-gradient(circle, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.02) 40%, transparent 70%);
            pointer-events: none;
            z-index: 0;
          }

          .login-card {
            position: relative;
            z-index: 1;
            width: 100%;
            max-width: 400px;
            margin: 0 1rem;
          }

          .card-inner {
            background: rgba(15, 23, 42, 0.6);
            backdrop-filter: blur(24px) saturate(1.5);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 1.5rem;
            padding: 3rem 2.5rem;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5),
                        0 0 0 1px rgba(255, 255, 255, 0.03);
          }

          .signal-icon {
            filter: drop-shadow(0 0 8px rgba(245, 158, 11, 0.5));
          }

          .logo-group {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
            margin-bottom: 2rem;
          }

          .logo-text {
            display: flex;
            flex-direction: column;
            line-height: 1;
          }

          .logo-onn {
            font-size: 1.75rem;
            font-weight: 800;
            letter-spacing: -0.02em;
            color: #fff;
          }

          .logo-sub {
            font-size: 0.55rem;
            font-weight: 600;
            letter-spacing: 0.15em;
            text-transform: uppercase;
            color: #64748b;
          }

          h1 {
            font-size: 1.5rem;
            font-weight: 700;
            color: #fff;
            text-align: center;
            margin-bottom: 0.375rem;
          }

          .subtitle {
            font-size: 0.875rem;
            color: #94a3b8;
            text-align: center;
            margin-bottom: 2rem;
          }

          .input-wrap {
            margin-bottom: 1rem;
          }

          input[type="text"] {
            width: 100%;
            padding: 0.875rem 1rem;
            background: rgba(15, 23, 42, 0.8);
            border: 1px solid #334155;
            border-radius: 0.875rem;
            color: #f8fafc;
            font-size: 0.875rem;
            font-family: inherit;
            outline: none;
            transition: all 0.2s;
          }

          input[type="text"]::placeholder {
            color: #475569;
          }

          input[type="text"]:focus {
            border-color: rgba(245, 158, 11, 0.4);
            box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1);
          }

          .submit-btn {
            width: 100%;
            padding: 0.875rem;
            border: none;
            border-radius: 0.875rem;
            background: linear-gradient(135deg, #f59e0b, #f97316);
            color: #fff;
            font-size: 0.875rem;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            transition: all 0.2s;
            box-shadow: 0 4px 14px rgba(245, 158, 11, 0.25);
          }

          .submit-btn:hover {
            background: linear-gradient(135deg, #fbbf24, #fb923c);
            box-shadow: 0 6px 20px rgba(245, 158, 11, 0.35);
            transform: translateY(-1px);
          }

          .submit-btn:active {
            transform: translateY(0);
          }

          .footer-text {
            text-align: center;
            font-size: 0.75rem;
            color: #475569;
            margin-top: 1.5rem;
          }

          .footer-text a {
            color: #f59e0b;
            text-decoration: none;
            transition: color 0.2s;
          }

          .footer-text a:hover {
            color: #fbbf24;
          }

          .divider {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin: 1.5rem 0;
          }

          .divider::before, .divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: #1e293b;
          }

          .divider span {
            font-size: 0.7rem;
            color: #475569;
            text-transform: uppercase;
            letter-spacing: 0.1em;
          }

          .back-link {
            display: block;
            text-align: center;
            margin-top: 1.5rem;
            font-size: 0.8125rem;
            color: #64748b;
            text-decoration: none;
            transition: color 0.2s;
          }

          .back-link:hover {
            color: #f59e0b;
          }

          /* Subtle float animation for the card */
          @keyframes floatIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }

          .login-card {
            animation: floatIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
          }

          /* Gradient accent line at very top of page */
          .top-accent {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: linear-gradient(90deg, #ef4444, #f59e0b);
            z-index: 10;
          }
        </style>
      </head>
      <body>
        <div class="top-accent"></div>

        <div class="login-card">
          <div class="card-inner">
            <!-- Logo -->
            <div class="logo-group">
              <svg class="signal-icon" width="36" height="36" viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="32" r="5" fill="#f59e0b"/>
                <path d="M32 20a12 12 0 0 1 0 24a12 12 0 0 1 0-24" stroke="#f59e0b" stroke-width="4" stroke-dasharray="18.85 18.85" stroke-linecap="round"/>
                <path d="M32 12a20 20 0 0 1 0 40a20 20 0 0 1 0-40" stroke="#f59e0b" stroke-width="3.5" stroke-dasharray="31.42 31.42" stroke-linecap="round"/>
                <path d="M32 5a27 27 0 0 1 0 54a27 27 0 0 1 0-54" stroke="#f59e0b" stroke-width="3" stroke-dasharray="42.41 42.41" stroke-linecap="round"/>
              </svg>
              <div class="logo-text">
                <span class="logo-onn title-font">ONN</span>
                <span class="logo-sub">Open News Network</span>
              </div>
            </div>

            <!-- Heading -->
            <h1 class="title-font">Sign in with Bluesky</h1>
            <p class="subtitle">Connect your AT Protocol identity to continue</p>

            <!-- Form -->
            <form action="/oauth/login" method="GET">
              ${returnTo ? html`<input type="hidden" name="returnTo" value="${returnTo}" />` : ''}
              <div class="input-wrap">
                <input
                  type="text"
                  name="handle"
                  placeholder="your.bsky.social"
                  required
                  autofocus
                  autocomplete="username"
                  autocapitalize="none"
                  autocorrect="off"
                  spellcheck="false"
                />
              </div>
              <button type="submit" class="submit-btn">
                Continue with Bluesky
              </button>
            </form>

            <p class="footer-text">
              No account? <a href="https://bsky.app" target="_blank" rel="noopener">Join Bluesky</a>
            </p>
          </div>

          <a href="/" class="back-link">← Back to ONN</a>
        </div>
      </body>
    </html>
  `;
}

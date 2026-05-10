/** @jsxImportSource hono/jsx */
import { BASE_STYLES, HEADER_STYLES, NAV_STYLES, FontLinks, TopHeader, LeftNav } from './partials.js';
import type { UserProfile } from './partials.js';

const PAGE_STYLES = `
.center-content { flex: 1; min-width: 0; border-right: 1px solid var(--border); border-left: 1px solid var(--border); }
.page-header { padding: 2rem 2rem 1.5rem; border-bottom: 1px solid var(--border); }
.page-header h1 { font-family: var(--font-body); font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; letter-spacing: -0.02em; }
.page-header p { font-size: 0.9rem; color: var(--text-secondary); line-height: 1.6; max-width: 520px; }
.submit-container { padding: 2rem; }
.submit-form { display: flex; flex-direction: column; gap: 1.25rem; max-width: 560px; }
.form-group { display: flex; flex-direction: column; gap: 0.35rem; }
.form-label { font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); }
.form-hint { font-size: 0.7rem; color: var(--text-muted); }
.form-input { padding: 0.65rem 0.85rem; border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; font-family: var(--font-sans); background: var(--bg); color: var(--text-main); outline: none; transition: border-color 0.15s; }
.form-input:focus { border-color: var(--text-muted); }
.form-input::placeholder { color: var(--text-muted); }
textarea.form-input { min-height: 80px; resize: vertical; line-height: 1.5; }
.submit-btn { align-self: flex-start; padding: 0.6rem 2rem; background: var(--accent); color: var(--bg); border: none; border-radius: 99px; font-size: 0.875rem; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.submit-btn:hover { background: var(--accent-hover); }
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.auth-prompt { padding: 3rem 2rem; text-align: center; color: var(--text-muted); }
.auth-prompt a { color: var(--accent); text-decoration: none; font-weight: 600; }
#submit-feedback { display: none; padding: 0.75rem; border-radius: 8px; font-size: 0.85rem; }
`;

export function SubmitPage({
  profile, prefillTopic,
}: {
  profile?: UserProfile | null;
  prefillTopic?: string;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Submit Citation — Centipedia</title>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <FontLinks />
        <style dangerouslySetInnerHTML={{__html: BASE_STYLES + HEADER_STYLES + NAV_STYLES + PAGE_STYLES}} />
      </head>
      <body>
        <TopHeader profile={profile} />
        <div class="app-shell">
          <LeftNav active="submit" profile={profile} />
          <main class="center-content">
            <div class="page-header">
              <h1>Submit a Citation</h1>
              <p>Share a source you trust. Our agents will validate the content, extract key facts, and incorporate them into the encyclopedia — with your DID attached as the endorser.</p>
            </div>

            {profile ? (
              <div class="submit-container">
                <form class="submit-form" id="citation-form">
                  <div class="form-group">
                    <label class="form-label">Source URL *</label>
                    <input type="url" name="url" class="form-input" placeholder="https://..." required />
                    <span class="form-hint">Article, research paper, news report, or Bluesky post</span>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Topic</label>
                    <input type="text" name="topic" class="form-input" placeholder="e.g., Climate Science, mRNA Vaccines, AT Protocol" value={prefillTopic || ''} />
                    <span class="form-hint">Optional. Helps agents categorize this source.</span>
                  </div>
                  <div class="form-group">
                    <label class="form-label">Notes</label>
                    <textarea name="excerpt" class="form-input" placeholder="Why is this source important? What key claims does it make?"></textarea>
                    <span class="form-hint">Optional. Context for the research agents.</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; border-radius: 8px; background: var(--bg-secondary); font-size: 0.8rem; color: var(--text-secondary);">
                    <span style="font-size: 1.1rem;">🔗</span>
                    Submitting as <strong style="color: var(--text-main);">@{profile.handle}</strong> — your DID will be permanently linked to this citation.
                  </div>
                  <button type="submit" class="submit-btn">Submit Citation</button>
                </form>
                <div id="submit-feedback"></div>
              </div>
            ) : (
              <div class="auth-prompt">
                <p>You need to <a href="/login">sign in</a> with your AT Protocol identity to submit citations.</p>
                <p style="margin-top: 0.5rem; font-size: 0.8rem;">Your DID is permanently attached to each citation — it's how your social graph builds trust.</p>
              </div>
            )}
          </main>
        </div>

        <script dangerouslySetInnerHTML={{__html: `
          const form = document.getElementById('citation-form');
          if (form) {
            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              const fb = document.getElementById('submit-feedback');
              const url = form.url.value.trim();
              const topic = form.topic.value.trim();
              const excerpt = form.excerpt.value.trim();
              if (!url) return;

              form.querySelector('button').disabled = true;
              form.querySelector('button').textContent = 'Submitting...';

              try {
                const res = await fetch('/api/citations', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url, topic: topic || null, excerpt: excerpt || null })
                });
                const data = await res.json();
                if (res.ok) {
                  fb.style.display = 'block';
                  fb.style.background = 'var(--bg-secondary)';
                  fb.style.color = 'var(--accent)';
                  fb.innerHTML = '✓ Citation submitted! Our agents will review it shortly. <a href="/submit" style="color: var(--text-secondary); margin-left: 0.5rem;">Submit another</a>';
                  form.reset();
                } else if (res.status === 409) {
                  fb.style.display = 'block';
                  fb.style.background = '#fffbeb';
                  fb.style.color = '#d97706';
                  fb.textContent = data.error || 'This URL has already been submitted.';
                } else {
                  fb.style.display = 'block';
                  fb.style.background = '#fef2f2';
                  fb.style.color = '#dc2626';
                  fb.textContent = data.error || 'Failed to submit';
                }
              } catch(err) {
                fb.style.display = 'block';
                fb.style.color = '#dc2626';
                fb.textContent = 'Network error';
              }
              form.querySelector('button').disabled = false;
              form.querySelector('button').textContent = 'Submit Citation';
            });
          }
        `}} />
      </body>
    </html>
  );
}

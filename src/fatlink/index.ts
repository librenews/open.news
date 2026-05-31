import { Hono } from 'hono';
import { html } from 'hono/html';
import { serve } from '@hono/node-server';
import { logger } from '../lib/logger.js';
import { pool } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { authRouter, getSession } from './routes/auth.js';
import { Layout } from './views/layout.js';
import { llm } from '../services/llm.js';
import type { LLMMessage } from '../services/llm.js';
import * as crypto from 'crypto';

process.on('unhandledRejection', (err) => {
  logger.warn({ err }, 'Caught unhandled promise rejection in fat.link');
});

const app = new Hono();

app.route('/', authRouter);

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateSlug(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function getPermission(artifact: { id: number | bigint; owner_did: string }, did: string | null): Promise<'owner' | 'write' | 'read' | null> {
  if (did === artifact.owner_did) return 'owner';
  if (!did) {
    const { rows } = await pool.query("SELECT permission FROM fatlink_acl WHERE artifact_id = $1 AND did = '*'", [artifact.id]);
    return rows[0]?.permission || null;
  }
  const { rows } = await pool.query(
    `SELECT permission FROM fatlink_acl WHERE artifact_id = $1 AND did IN ($2, '*')
     ORDER BY CASE WHEN did = $2 THEN 0 ELSE 1 END LIMIT 1`,
    [artifact.id, did]
  );
  return rows[0]?.permission || null;
}

const SYSTEM_PROMPT = `You are an artifact generator for fat.link. Generate a single, self-contained HTML document with inline CSS and JavaScript.

Rules:
1. Output ONLY the HTML — no markdown fences, no explanations
2. Must be a complete <!DOCTYPE html> page
3. Use only inline <style> and <script> tags (NO external resources, NO CDN links)
4. Make it visually polished with modern dark-theme design
5. Make it interactive where appropriate (animations, hover effects, dynamic content)
6. Do NOT include fetch(), XMLHttpRequest, or any external network calls
7. Do NOT include <form action="..."> pointing to external URLs
8. Keep total output under 100KB
9. Use clean, semantic HTML5

If given an existing artifact and a modification prompt, return the COMPLETE updated HTML (not a diff).`;

// ── Homepage ────────────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const session = await getSession(c);

  if (!session) {
    return c.html(Layout({
      title: 'fat.link — create with AI',
      session: null,
      children: html`
        <div style="text-align: center; padding-top: 6rem;" class="fade-in">
          <h1 style="font-size: 2.8rem; font-weight: 800; letter-spacing: -0.04em; line-height: 1.1; margin-bottom: 0.75rem;">
            fat<span style="color: var(--accent);">.link</span>
          </h1>
          <p style="font-size: 1.05rem; color: var(--text-secondary); max-width: 380px; margin: 0 auto 2rem;">
            Create interactive pages with AI.<br />Share a link. That's it.
          </p>
          <form action="/oauth/login" method="get" style="max-width: 320px; margin: 0 auto; display: flex; flex-direction: column; gap: 0.6rem;">
            <input name="handle" type="text" placeholder="yourname.bsky.social" required class="input" style="text-align: center;" />
            <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center; padding: 0.6rem;">
              Sign in with Bluesky
            </button>
          </form>
        </div>
      `,
    }));
  }

  // Dashboard
  const { rows: artifacts } = await pool.query(
    `SELECT * FROM fatlink_artifacts WHERE owner_did = $1 ORDER BY updated_at DESC`,
    [session.did]
  );

  return c.html(Layout({
    title: 'fat.link — your pages',
    session,
    children: html`
      <div class="fade-in">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <h1 style="font-size: 1.3rem; font-weight: 700; letter-spacing: -0.02em;">Your pages</h1>
        </div>

        <!-- Create form -->
        <div class="card" style="margin-bottom: 1.5rem;">
          <form id="create-form" style="display: flex; gap: 0.5rem; align-items: flex-start;">
            <textarea name="prompt" placeholder="Describe what you want to create... e.g. 'A dashboard showing the phases of the moon'" required class="input" style="flex: 1; min-height: 44px; max-height: 120px;"></textarea>
            <button type="submit" class="btn btn-primary" style="margin-top: 1px; white-space: nowrap;">Create</button>
          </form>
          <div id="create-status" style="margin-top: 0.75rem; display: none;"></div>
        </div>

        ${artifacts.length === 0
          ? html`
            <div style="text-align: center; padding: 3rem 0; color: var(--text-muted);">
              <p style="font-size: 1.5rem; margin-bottom: 0.5rem;">✨</p>
              <p style="font-size: 0.88rem;">Describe anything above and AI will create an interactive page for you.</p>
            </div>
          `
          : html`
            <div style="display: flex; flex-direction: column; gap: 0.6rem;">
              ${artifacts.map((a: any) => html`
                <a href="/${a.slug}" class="card" style="text-decoration: none; color: inherit; display: block;">
                  <div style="display: flex; justify-content: space-between; align-items: baseline;">
                    <div>
                      <div style="font-weight: 600; font-size: 0.95rem;">${a.title}</div>
                      <div style="color: var(--text-muted); font-size: 0.78rem; margin-top: 0.3rem;">
                        fat.link/${a.slug} · v${a.version}
                      </div>
                    </div>
                    <div style="color: var(--text-muted); font-size: 0.75rem; white-space: nowrap; margin-left: 1rem;">
                      ${new Date(a.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                </a>
              `)}
            </div>
          `
        }
      </div>

      <script>
        document.getElementById('create-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const form = e.target;
          const btn = form.querySelector('button');
          const status = document.getElementById('create-status');
          const prompt = form.prompt.value.trim();
          if (!prompt) return;

          btn.disabled = true;
          btn.textContent = 'Creating...';
          status.style.display = 'block';
          status.innerHTML = '<div style="display:flex;align-items:center;gap:0.5rem;color:var(--accent);font-size:0.85rem;"><span class="loading-dot">●</span> Generating your page...</div>';

          try {
            const res = await fetch('/api/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt }),
            });
            const data = await res.json();
            if (data.slug) {
              window.location.href = '/' + data.slug;
            } else {
              status.innerHTML = '<div style="color:var(--red);font-size:0.85rem;">' + (data.error || 'Failed to create') + '</div>';
              btn.disabled = false;
              btn.textContent = 'Create';
            }
          } catch {
            status.innerHTML = '<div style="color:var(--red);font-size:0.85rem;">Network error</div>';
            btn.disabled = false;
            btn.textContent = 'Create';
          }
        });
      </script>
    `,
  }));
});

// ── Create API ──────────────────────────────────────────────────────────────

app.post('/api/create', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'Not authenticated' }, 401);

  const { prompt } = await c.req.json();
  if (!prompt?.trim()) return c.json({ error: 'Prompt is required' }, 400);

  try {
    // Generate HTML via LLM
    const messages: LLMMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt.trim() },
    ];

    const response = await llm.complete(messages, { maxTokens: 16384 });
    let generatedHtml = response.text.trim();

    // Strip markdown fences if the LLM wrapped it
    generatedHtml = generatedHtml.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '');

    // Extract title from generated HTML
    const titleMatch = generatedHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim() || prompt.trim().slice(0, 60);

    // Generate unique slug
    let slug: string;
    let attempts = 0;
    do {
      slug = generateSlug();
      const { rows } = await pool.query('SELECT 1 FROM fatlink_artifacts WHERE slug = $1', [slug]);
      if (rows.length === 0) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) return c.json({ error: 'Failed to generate unique slug' }, 500);

    // Insert artifact
    const { rows } = await pool.query(
      `INSERT INTO fatlink_artifacts (slug, title, owner_did, html, prompt, version)
       VALUES ($1, $2, $3, $4, $5, 1) RETURNING id`,
      [slug, title, session.did, generatedHtml, prompt.trim()]
    );

    // Save version 1
    await pool.query(
      `INSERT INTO fatlink_versions (artifact_id, version, html, prompt, author_did)
       VALUES ($1, 1, $2, $3, $4)`,
      [rows[0].id, generatedHtml, prompt.trim(), session.did]
    );

    logger.info({
      event: 'artifact_created', slug, did: session.did,
      tokens: { input: response.inputTokens, output: response.outputTokens },
    }, 'Artifact created');

    return c.json({ slug, title });
  } catch (err) {
    logger.error({ err }, 'Artifact creation failed');
    return c.json({ error: 'Generation failed. Please try again.' }, 500);
  }
});

// ── Prompt (iterate) API ────────────────────────────────────────────────────

app.post('/api/:slug/prompt', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'Not authenticated' }, 401);

  const slug = c.req.param('slug');
  const { rows: artifacts } = await pool.query(
    'SELECT * FROM fatlink_artifacts WHERE slug = $1', [slug]
  );
  if (artifacts.length === 0) return c.json({ error: 'Not found' }, 404);

  const artifact = artifacts[0];
  const perm = await getPermission(artifact, session.did);
  if (perm !== 'owner' && perm !== 'write') return c.json({ error: 'Not authorized' }, 403);

  const { prompt } = await c.req.json();
  if (!prompt?.trim()) return c.json({ error: 'Prompt is required' }, 400);

  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Here is the current artifact:\n\n${artifact.html}\n\nModification request: ${prompt.trim()}` },
    ];

    const response = await llm.complete(messages, { maxTokens: 16384 });
    let updatedHtml = response.text.trim();
    updatedHtml = updatedHtml.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '');

    const newVersion = artifact.version + 1;
    const titleMatch = updatedHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
    const newTitle = titleMatch?.[1]?.trim() || artifact.title;

    // Update artifact
    await pool.query(
      `UPDATE fatlink_artifacts SET html = $1, title = $2, version = $3, updated_at = NOW() WHERE id = $4`,
      [updatedHtml, newTitle, newVersion, artifact.id]
    );

    // Save version
    await pool.query(
      `INSERT INTO fatlink_versions (artifact_id, version, html, prompt, author_did)
       VALUES ($1, $2, $3, $4, $5)`,
      [artifact.id, newVersion, updatedHtml, prompt.trim(), session.did]
    );

    logger.info({
      event: 'artifact_updated', slug, version: newVersion, did: session.did,
      tokens: { input: response.inputTokens, output: response.outputTokens },
    }, 'Artifact updated');

    return c.json({ version: newVersion, title: newTitle });
  } catch (err) {
    logger.error({ err, slug }, 'Artifact update failed');
    return c.json({ error: 'Update failed. Please try again.' }, 500);
  }
});

// ── Render (raw HTML for iframe) ────────────────────────────────────────────

app.get('/api/:slug/render', async (c) => {
  const slug = c.req.param('slug');
  const { rows } = await pool.query('SELECT html, is_public, owner_did FROM fatlink_artifacts WHERE slug = $1', [slug]);
  if (rows.length === 0) return c.text('Not found', 404);

  const artifact = rows[0];
  if (!artifact.is_public) {
    const session = await getSession(c);
    const perm = await getPermission(artifact, session?.did || null);
    if (!perm) return c.text('Not authorized', 403);
  }

  // Inject CSP meta tag for sandbox safety
  let safeHtml = artifact.html;
  if (!safeHtml.includes('Content-Security-Policy')) {
    safeHtml = safeHtml.replace(
      '<head>',
      `<head>\n<meta http-equiv="Content-Security-Policy" content="default-src 'unsafe-inline' data: blob:; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none';">`
    );
  }

  return new Response(safeHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Frame-Options': 'SAMEORIGIN',
      'Cache-Control': 'no-cache',
    },
  });
});

// ── Version History ─────────────────────────────────────────────────────────

app.get('/api/:slug/history', async (c) => {
  const slug = c.req.param('slug');
  const { rows: artifacts } = await pool.query('SELECT id, owner_did FROM fatlink_artifacts WHERE slug = $1', [slug]);
  if (artifacts.length === 0) return c.json({ error: 'Not found' }, 404);

  const session = await getSession(c);
  const perm = await getPermission(artifacts[0], session?.did || null);
  if (!perm) return c.json({ error: 'Not authorized' }, 403);

  const { rows } = await pool.query(
    `SELECT v.version, v.prompt, v.author_did, v.created_at, u.handle AS author_handle
     FROM fatlink_versions v
     LEFT JOIN fatlink_users u ON u.did = v.author_did
     WHERE v.artifact_id = $1
     ORDER BY v.version DESC`,
    [artifacts[0].id]
  );

  return c.json({ versions: rows });
});

// ── Delete API ──────────────────────────────────────────────────────────────

app.delete('/api/:slug', async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'Not authenticated' }, 401);

  const slug = c.req.param('slug');
  const { rows } = await pool.query('SELECT id, owner_did FROM fatlink_artifacts WHERE slug = $1', [slug]);
  if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
  if (rows[0].owner_did !== session.did) return c.json({ error: 'Not authorized' }, 403);

  await pool.query('DELETE FROM fatlink_artifacts WHERE id = $1', [rows[0].id]);
  logger.info({ event: 'artifact_deleted', slug, did: session.did }, 'Artifact deleted');
  return c.json({ success: true });
});

// ── Artifact Page ───────────────────────────────────────────────────────────

app.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const { rows } = await pool.query(
    `SELECT a.*, u.handle AS owner_handle, u.avatar AS owner_avatar
     FROM fatlink_artifacts a
     JOIN fatlink_users u ON u.did = a.owner_did
     WHERE a.slug = $1`,
    [slug]
  );

  if (rows.length === 0) {
    return c.html(Layout({
      title: 'Not Found — fat.link',
      session: null,
      children: html`
        <div style="text-align: center; padding-top: 6rem;">
          <h1 style="font-size: 4rem; opacity: 0.1; font-weight: 800;">404</h1>
          <p style="color: var(--text-secondary);">This page doesn't exist.</p>
          <a href="/" style="display: inline-block; margin-top: 1rem;" class="btn btn-ghost">← Home</a>
        </div>
      `,
    }), 404);
  }

  const artifact = rows[0];
  const session = await getSession(c);
  const perm = await getPermission(artifact, session?.did || null);
  const canEdit = perm === 'owner' || perm === 'write';
  const isOwner = perm === 'owner';

  // Public viewers can see if is_public, otherwise need permission
  if (!artifact.is_public && !perm) {
    return c.html(Layout({
      title: 'Private — fat.link',
      session,
      children: html`
        <div style="text-align: center; padding-top: 6rem;">
          <h1 style="font-size: 4rem; opacity: 0.1; font-weight: 800;">🔒</h1>
          <p style="color: var(--text-secondary);">This page is private.</p>
          <a href="/" style="display: inline-block; margin-top: 1rem;" class="btn btn-ghost">← Home</a>
        </div>
      `,
    }), 403);
  }

  return c.html(Layout({
    title: `${artifact.title} — fat.link`,
    session,
    wide: true,
    children: html`
      <div class="fade-in" style="display: flex; gap: 1.25rem; min-height: calc(100vh - 140px);">
        <!-- Artifact render -->
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
            <div>
              <h1 style="font-size: 1.2rem; font-weight: 700; letter-spacing: -0.02em;">${artifact.title}</h1>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">
                by @${artifact.owner_handle} · v${artifact.version}
              </div>
            </div>
            ${isOwner ? html`
              <button onclick="if(confirm('Delete this page?'))fetch('/api/${slug}',{method:'DELETE'}).then(()=>location.href='/')" class="btn btn-ghost" style="font-size: 0.75rem; padding: 0.3rem 0.6rem; color: var(--red);">Delete</button>
            ` : ''}
          </div>
          <div style="border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; background: white;">
            <iframe
              src="/api/${slug}/render"
              sandbox="allow-scripts"
              style="width: 100%; height: calc(100vh - 220px); border: none; display: block;"
              title="${escapeHtml(artifact.title)}"
            ></iframe>
          </div>
        </div>

        <!-- Chat panel (editors only) -->
        ${canEdit && session ? html`
          <div style="width: 340px; flex-shrink: 0; display: flex; flex-direction: column;">
            <div style="font-size: 0.85rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--text-secondary);">Edit with AI</div>
            <div id="chat-log" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem; max-height: calc(100vh - 300px);"></div>
            <form id="chat-form" style="display: flex; gap: 0.5rem;">
              <textarea name="prompt" placeholder="Describe a change..." required class="input" style="flex: 1; min-height: 40px; max-height: 100px; font-size: 0.85rem;"></textarea>
              <button type="submit" class="btn btn-primary" style="align-self: flex-end;">Send</button>
            </form>
          </div>

          <script>
          (function() {
            var form = document.getElementById('chat-form');
            var log = document.getElementById('chat-log');
            var iframe = document.querySelector('iframe');
            var SLUG = '${slug}';

            function addMsg(role, text) {
              var div = document.createElement('div');
              div.style.cssText = role === 'user'
                ? 'background:var(--accent-subtle);border:1px solid rgba(124,92,252,0.2);border-radius:8px;padding:0.5rem 0.7rem;font-size:0.82rem;align-self:flex-end;max-width:90%;word-break:break-word;'
                : 'background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:0.5rem 0.7rem;font-size:0.82rem;max-width:90%;word-break:break-word;color:var(--text-secondary);';
              div.textContent = text;
              log.appendChild(div);
              log.scrollTop = log.scrollHeight;
              return div;
            }

            form.addEventListener('submit', async function(e) {
              e.preventDefault();
              var prompt = form.prompt.value.trim();
              if (!prompt) return;

              addMsg('user', prompt);
              form.prompt.value = '';
              var btn = form.querySelector('button');
              btn.disabled = true;
              btn.textContent = '...';
              var statusEl = addMsg('assistant', '● Generating...');
              statusEl.querySelector || (statusEl.innerHTML = '<span class="loading-dot">●</span> Generating...');

              try {
                var res = await fetch('/api/' + SLUG + '/prompt', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ prompt: prompt }),
                });
                var data = await res.json();
                if (data.version) {
                  statusEl.textContent = '✓ Updated to v' + data.version;
                  statusEl.style.color = 'var(--green)';
                  iframe.src = '/api/' + SLUG + '/render?v=' + data.version;
                } else {
                  statusEl.textContent = '✗ ' + (data.error || 'Failed');
                  statusEl.style.color = 'var(--red)';
                }
              } catch {
                statusEl.textContent = '✗ Network error';
                statusEl.style.color = 'var(--red)';
              }
              btn.disabled = false;
              btn.textContent = 'Send';
            });
          })();
          </script>
        ` : ''}
      </div>
    `,
  }));
});

// ── Error handling ──────────────────────────────────────────────────────────

app.onError((err, c) => {
  logger.error({ err, path: c.req.path }, 'fat.link request error');
  return c.html(Layout({
    title: 'Error — fat.link',
    session: null,
    children: html`
      <div style="text-align: center; padding-top: 6rem;">
        <h1 style="font-size: 4rem; opacity: 0.1; font-weight: 800;">500</h1>
        <p style="color: var(--text-secondary);">Something went wrong.</p>
        <a href="/" style="display: inline-block; margin-top: 1rem;" class="btn btn-ghost">← Home</a>
      </div>
    `,
  }), 500);
});

app.notFound((c) => {
  return c.html(Layout({
    title: 'Not Found — fat.link',
    session: null,
    children: html`
      <div style="text-align: center; padding-top: 6rem;">
        <h1 style="font-size: 4rem; opacity: 0.1; font-weight: 800;">404</h1>
        <p style="color: var(--text-secondary);">Not found.</p>
        <a href="/" style="display: inline-block; margin-top: 1rem;" class="btn btn-ghost">← Home</a>
      </div>
    `,
  }), 404);
});

// ── Start ───────────────────────────────────────────────────────────────────

const FATLINK_PORT = Number(process.env.FATLINK_PORT) || 4900;

async function start() {
  await runMigrations();
  serve({ fetch: app.fetch, port: FATLINK_PORT }, () => {
    logger.info({ port: FATLINK_PORT }, 'fat.link server started');
  });
}

start().catch((err) => {
  logger.error({ err }, 'fat.link startup failed');
  process.exit(1);
});

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

/** Strip dangerous/useless tags from LLM-generated HTML */
function sanitizeHtml(rawHtml: string): string {
  let html = rawHtml;
  // Remove tags with zero product value inside an artifact
  html = html.replace(/<meta\s+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
  html = html.replace(/<base[^>]*>/gi, '');
  html = html.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '');
  html = html.replace(/<iframe[^>]*\/>/gi, '');
  html = html.replace(/<object[^>]*>[\s\S]*?<\/object>/gi, '');
  html = html.replace(/<embed[^>]*>/gi, '');
  html = html.replace(/<applet[^>]*>[\s\S]*?<\/applet>/gi, '');
  // Remove external script/link tags (keep inline)
  html = html.replace(/<script[^>]+src\s*=[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<link[^>]+rel\s*=\s*["']stylesheet["'][^>]*>/gi, '');
  // Remove password inputs (anti-phishing)
  html = html.replace(/<input[^>]+type\s*=\s*["']password["'][^>]*>/gi, '');
  // Remove form actions pointing externally
  html = html.replace(/<form[^>]+action\s*=\s*["']https?:\/\/[^>]*>/gi, '<form>');
  return html;
}

/** Rewrite links in artifact HTML to go through /out?url= */
function rewriteLinks(rawHtml: string): string {
  return rawHtml.replace(
    /<a\s([^>]*?)href\s*=\s*["'](https?:\/\/[^"']+)["']([^>]*?)>/gi,
    (_, before, url, after) => {
      const safeUrl = encodeURIComponent(url);
      return `<a ${before}href="/out?url=${safeUrl}" rel="noopener noreferrer" target="_top"${after}>`;
    }
  );
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
8. Do NOT include <iframe>, <object>, <embed>, or <input type="password">
9. Keep total output under 100KB
10. Use clean, semantic HTML5

If given an existing artifact and a modification prompt, return the COMPLETE updated HTML (not a diff).`;

// ── Outbound Link Redirect ──────────────────────────────────────────────────

app.get('/out', (c) => {
  const url = c.req.query('url');
  if (!url) return c.text('Missing url parameter', 400);

  // Validate it's a real URL
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return c.text('Invalid URL', 400);
    }
  } catch {
    return c.text('Invalid URL', 400);
  }

  logger.info({ event: 'outbound_click', url }, 'Outbound link clicked');
  return c.redirect(url);
});

// ── Report API ──────────────────────────────────────────────────────────────

app.post('/api/:slug/report', async (c) => {
  const slug = c.req.param('slug');
  const session = await getSession(c);

  const { rows } = await pool.query('SELECT id FROM fatlink_artifacts WHERE slug = $1', [slug]);
  if (rows.length === 0) return c.json({ error: 'Not found' }, 404);

  logger.warn({
    event: 'content_report',
    slug,
    artifact_id: rows[0].id,
    reporter_did: session?.did || 'anonymous',
  }, 'Content reported as harmful');

  return c.json({ success: true });
});

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

    // Sanitize: strip dangerous/useless tags
    generatedHtml = sanitizeHtml(generatedHtml);

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
      `INSERT INTO fatlink_versions (artifact_id, version, html, prompt, author_did, llm_provider, llm_model, input_tokens, output_tokens)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8)`,
      [rows[0].id, generatedHtml, prompt.trim(), session.did, response.provider, response.model, response.inputTokens, response.outputTokens]
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
    updatedHtml = sanitizeHtml(updatedHtml);

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
      `INSERT INTO fatlink_versions (artifact_id, version, html, prompt, author_did, llm_provider, llm_model, input_tokens, output_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [artifact.id, newVersion, updatedHtml, prompt.trim(), session.did, response.provider, response.model, response.inputTokens, response.outputTokens]
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

  // Rewrite external links through /out?url= and inject CSP
  let safeHtml = rewriteLinks(artifact.html);
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

// ── ACL API ─────────────────────────────────────────────────────────────────

app.get('/api/:slug/acl', async (c) => {
  const session = await getSession(c);
  const slug = c.req.param('slug');
  const { rows: artifacts } = await pool.query('SELECT id, owner_did FROM fatlink_artifacts WHERE slug = $1', [slug]);
  if (artifacts.length === 0) return c.json({ error: 'Not found' }, 404);
  if (!session || session.did !== artifacts[0].owner_did) return c.json({ error: 'Unauthorized' }, 403);

  const { rows } = await pool.query('SELECT did, permission FROM fatlink_acl WHERE artifact_id = $1', [artifacts[0].id]);
  const acls = await Promise.all(rows.map(async (r: any) => {
    try {
      const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(r.did)}`).then(r => r.json()) as any;
      return { did: r.did, permission: r.permission, handle: res?.handle || r.did };
    } catch { return { did: r.did, permission: r.permission, handle: r.did }; }
  }));
  return c.json({ acls });
});

app.post('/api/:slug/acl', async (c) => {
  const session = await getSession(c);
  const slug = c.req.param('slug');
  const { rows: artifacts } = await pool.query('SELECT id, owner_did FROM fatlink_artifacts WHERE slug = $1', [slug]);
  if (artifacts.length === 0) return c.json({ error: 'Not found' }, 404);
  if (!session || session.did !== artifacts[0].owner_did) return c.json({ error: 'Unauthorized' }, 403);

  const { handle } = await c.req.json();
  if (!handle?.trim()) return c.json({ error: 'Handle is required' }, 400);

  let targetDid = handle.trim().replace(/^@/, '');
  if (!targetDid.startsWith('did:')) {
    const res = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(targetDid)}`);
    if (!res.ok) return c.json({ error: 'Handle not found on Bluesky' }, 404);
    const data = await res.json() as any;
    targetDid = data.did;
  }

  await pool.query(
    `INSERT INTO fatlink_acl (artifact_id, did, permission) VALUES ($1, $2, 'write')
     ON CONFLICT (artifact_id, did) DO UPDATE SET permission = 'write'`,
    [artifacts[0].id, targetDid]
  );
  logger.info({ event: 'collab_added', slug, targetDid }, 'Collaborator added');
  return c.json({ success: true, did: targetDid });
});

app.delete('/api/:slug/acl', async (c) => {
  const session = await getSession(c);
  const slug = c.req.param('slug');
  const { rows: artifacts } = await pool.query('SELECT id, owner_did FROM fatlink_artifacts WHERE slug = $1', [slug]);
  if (artifacts.length === 0) return c.json({ error: 'Not found' }, 404);
  if (!session || session.did !== artifacts[0].owner_did) return c.json({ error: 'Unauthorized' }, 403);

  const { did } = await c.req.json();
  if (!did) return c.json({ error: 'Missing did' }, 400);
  await pool.query('DELETE FROM fatlink_acl WHERE artifact_id = $1 AND did = $2', [artifacts[0].id, did]);
  logger.info({ event: 'collab_removed', slug, did }, 'Collaborator removed');
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
            <div style="display: flex; gap: 0.4rem; align-items: center;">
              <a href="https://bsky.app/intent/compose?text=${encodeURIComponent(artifact.title + ' — made with fat.link\n\nhttps://fat.link/' + slug)}" target="_blank" rel="noopener" class="btn btn-ghost" style="font-size: 0.75rem; padding: 0.3rem 0.6rem;">Share on 🦋</a>
              ${isOwner ? html`
                <button onclick="document.getElementById('collab-modal').style.display='flex';loadCollabs()" class="btn btn-ghost" style="font-size: 0.75rem; padding: 0.3rem 0.6rem;">Collaborators</button>
                <button onclick="if(confirm('Delete this page?'))fetch('/api/${slug}',{method:'DELETE'}).then(()=>location.href='/')" class="btn btn-ghost" style="font-size: 0.75rem; padding: 0.3rem 0.6rem; color: var(--red);">Delete</button>
              ` : ''}
              <button onclick="if(confirm('Report this content as harmful or misleading?'))fetch('/api/${slug}/report',{method:'POST'}).then(()=>alert('Report submitted. Thank you.'))" class="btn btn-ghost" style="font-size: 0.75rem; padding: 0.3rem 0.6rem;">⚑ Report</button>
            </div>
          </div>

          <!-- Provenance bar -->
          <div style="display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 0.85rem; background: var(--bg-card); border: 1px solid var(--border); border-bottom: none; border-radius: var(--radius) var(--radius) 0 0; font-size: 0.72rem; color: var(--text-muted);">
            ${artifact.owner_avatar ? html`<img src="${artifact.owner_avatar}" alt="" style="width: 18px; height: 18px; border-radius: 50%;" />` : ''}
            <span>Created by <strong style="color: var(--text-secondary);">@${artifact.owner_handle}</strong></span>
            <span>·</span>
            <span>AI-generated</span>
            <span>·</span>
            <span>${new Date(artifact.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
            ${artifact.version > 1 ? html`<span>·</span><span>${artifact.version} revisions</span>` : ''}
          </div>

          <div style="border: 1px solid var(--border); border-radius: 0 0 var(--radius) var(--radius); overflow: hidden; background: white;">
            <iframe
              src="/api/${slug}/render"
              sandbox="allow-scripts"
              style="width: 100%; height: calc(100vh - 260px); border: none; display: block;"
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

      <!-- Collaborators Modal (owner only) -->
      ${isOwner ? html`
        <div id="collab-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 200; justify-content: center; align-items: center;" onclick="if(event.target===this)this.style.display='none'">
          <div class="card" style="width: 100%; max-width: 440px; margin: 1rem;" onclick="event.stopPropagation()">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <h2 style="font-size: 1.1rem; font-weight: 700;">Collaborators</h2>
              <button onclick="document.getElementById('collab-modal').style.display='none'" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1.2rem;">×</button>
            </div>
            <div style="display: flex; gap: 0.5rem; margin-bottom: 1.25rem;">
              <input id="collab-handle" type="text" placeholder="Handle (e.g. user.bsky.social)" class="input" style="flex: 1;" />
              <button id="collab-invite-btn" class="btn btn-primary" type="button">Invite</button>
            </div>
            <div id="collab-list" style="display: flex; flex-direction: column; gap: 0.6rem;">
              <div style="color: var(--text-muted); font-size: 0.82rem;">Loading...</div>
            </div>
          </div>
        </div>

        <script>
        var SLUG = '${slug}';
        function loadCollabs() {
          var list = document.getElementById('collab-list');
          list.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;">Loading...</div>';
          fetch('/api/' + SLUG + '/acl').then(r => r.json()).then(data => {
            if (!data.acls || data.acls.length === 0) {
              list.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;">No collaborators yet.</div>';
              return;
            }
            list.innerHTML = data.acls.map(a =>
              '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;">' +
              '<div><div style="font-weight:600;font-size:0.85rem;">@' + (a.handle || a.did) + '</div>' +
              '<div style="font-size:0.72rem;color:var(--text-muted);">Can edit</div></div>' +
              '<button data-did="' + a.did + '" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:0.8rem;" onclick="removeCollab(this)">Remove</button>' +
              '</div>'
            ).join('');
          }).catch(() => { list.innerHTML = '<div style="color:var(--red);">Failed to load</div>'; });
        }
        function removeCollab(btn) {
          if (!confirm('Remove this collaborator?')) return;
          fetch('/api/' + SLUG + '/acl', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ did: btn.getAttribute('data-did') }) })
            .then(() => loadCollabs());
        }
        document.getElementById('collab-invite-btn').addEventListener('click', function() {
          var h = document.getElementById('collab-handle').value.trim();
          if (!h) return;
          this.disabled = true; this.textContent = '...';
          fetch('/api/' + SLUG + '/acl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: h }) })
            .then(r => { if (!r.ok) return r.json().then(d => { alert(d.error || 'Failed'); }); document.getElementById('collab-handle').value = ''; loadCollabs(); })
            .catch(() => alert('Network error'))
            .finally(() => { document.getElementById('collab-invite-btn').disabled = false; document.getElementById('collab-invite-btn').textContent = 'Invite'; });
        });
        </script>
      ` : ''}
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

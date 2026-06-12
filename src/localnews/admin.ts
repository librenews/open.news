/**
 * Admin dashboard for localnews — password-protected source/submission management.
 */
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createHmac } from 'crypto';
import { pool } from '../db/client.js';
import { logger } from '../lib/logger.js';

const ADMIN_PASSWORD = process.env.LOCALNEWS_ADMIN_PASSWORD || 'Kx9$mTv2!pLqN7wR';
const SESSION_SECRET = process.env.SESSION_SECRET || 'ln-admin-secret';
const LN_DOMAIN = process.env.LOCALNEWS_DOMAIN || 'stamfordtimes.com';

function makeToken(): string {
  return createHmac('sha256', SESSION_SECRET).update(ADMIN_PASSWORD).digest('hex').slice(0, 32);
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const adminApp = new Hono();

// ── Auth ────────────────────────────────────────────────────────────────────

function isAuthed(c: any): boolean {
  return getCookie(c, 'ln_admin') === makeToken();
}

adminApp.use('/*', async (c, next) => {
  if (c.req.path === '/admin/login' || isAuthed(c)) return next();
  return c.redirect('/admin/login');
});

adminApp.get('/admin/login', (c) => {
  const error = c.req.query('error') ? '<p style="color:var(--accent);margin-bottom:1rem;">Invalid password</p>' : '';
  return c.html(layout('Login', `
    <div class="card" style="max-width:360px;margin:4rem auto;">
      <h2 style="margin-bottom:1rem;">Admin Login</h2>
      ${error}
      <form method="POST" action="/admin/login">
        <input type="password" name="password" placeholder="Password" required
          style="width:100%;padding:0.6rem;border:1px solid var(--rule);font-size:0.9rem;margin-bottom:0.75rem;">
        <button type="submit" class="btn">Sign In</button>
      </form>
    </div>
  `));
});

adminApp.post('/admin/login', async (c) => {
  const body = await c.req.parseBody();
  if (body.password === ADMIN_PASSWORD) {
    setCookie(c, 'ln_admin', makeToken(), { path: '/', httpOnly: true, maxAge: 86400 * 7, sameSite: 'Lax' });
    return c.redirect('/admin');
  }
  return c.redirect('/admin/login?error=1');
});

adminApp.get('/admin/logout', (c) => {
  setCookie(c, 'ln_admin', '', { path: '/', maxAge: 0 });
  return c.redirect('/admin/login');
});

// ── Dashboard ───────────────────────────────────────────────────────────────

adminApp.get('/admin', async (c) => {
  const [src, sub, ing, ent, evt] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS c FROM ln_sources WHERE active = true'),
    pool.query("SELECT COUNT(*)::int AS c FROM ln_submissions WHERE status = 'pending'"),
    pool.query("SELECT status, COUNT(*)::int AS c FROM ln_ingestions GROUP BY status"),
    pool.query('SELECT COUNT(*)::int AS c FROM ln_entities'),
    pool.query('SELECT COUNT(*)::int AS c FROM ln_events'),
  ]);

  const ingMap: Record<string, number> = {};
  for (const r of ing.rows) ingMap[r.status] = r.c;

  return c.html(layout('Dashboard', `
    <h1>Dashboard</h1>
    <div class="stats-row">
      <div class="stat-box"><div class="stat-n">${src.rows[0].c}</div><div class="stat-l">Active Sources</div></div>
      <div class="stat-box"><div class="stat-n" style="color:${sub.rows[0].c > 0 ? 'var(--accent)' : 'inherit'}">${sub.rows[0].c}</div><div class="stat-l">Pending Submissions</div></div>
      <div class="stat-box"><div class="stat-n">${ent.rows[0].c}</div><div class="stat-l">Entities</div></div>
      <div class="stat-box"><div class="stat-n">${evt.rows[0].c}</div><div class="stat-l">Events</div></div>
    </div>
    <div class="stats-row" style="margin-top:0.5rem;">
      <div class="stat-box"><div class="stat-n">${ingMap['processed'] || 0}</div><div class="stat-l">Processed</div></div>
      <div class="stat-box"><div class="stat-n">${ingMap['pending'] || 0}</div><div class="stat-l">Pending</div></div>
      <div class="stat-box"><div class="stat-n">${ingMap['failed'] || 0}</div><div class="stat-l">Failed</div></div>
      <div class="stat-box"><div class="stat-n">${ingMap['skipped'] || 0}</div><div class="stat-l">Skipped</div></div>
    </div>
    <div style="margin-top:2rem;display:flex;gap:1rem;flex-wrap:wrap;">
      <a href="/admin/sources" class="btn">Manage Sources</a>
      <a href="/admin/submissions" class="btn">Review Submissions</a>
      <a href="/admin/ingestions" class="btn btn-outline">Ingestion Log</a>
      <a href="/admin/entities" class="btn btn-outline">Entities</a>
      <a href="/admin/events" class="btn btn-outline">Events</a>
    </div>
  `));
});

// ── Sources ─────────────────────────────────────────────────────────────────

adminApp.get('/admin/sources', async (c) => {
  const { rows } = await pool.query('SELECT * FROM ln_sources ORDER BY created_at DESC');

  const sourceRows = rows.map(s => `
    <tr>
      <td><strong>${escHtml(s.name || '—')}</strong></td>
      <td><code style="font-size:0.75rem;">${escHtml(s.identifier)}</code></td>
      <td>${s.source_type}</td>
      <td>${s.active ? '✅' : '❌'}</td>
      <td style="font-size:0.78rem;color:var(--muted);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(s.instructions || '—')}</td>
    </tr>
  `).join('');

  return c.html(layout('Sources', `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;">
      <h1>Sources</h1>
      <a href="/admin/sources/new" class="btn">+ New Source</a>
    </div>
    <table>
      <thead><tr><th>Name</th><th>Address</th><th>Type</th><th>Active</th><th>Instructions</th></tr></thead>
      <tbody>${sourceRows || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem;">No sources yet</td></tr>'}</tbody>
    </table>
  `));
});

adminApp.get('/admin/sources/new', (c) => {
  return c.html(layout('New Source', `
    <h1>Create Source</h1>
    <form method="POST" action="/admin/sources/new" class="card" style="max-width:560px;">
      <label>Name <span style="color:var(--muted);font-size:0.8rem;">(e.g. "Farmhouse Restaurant Newsletter")</span></label>
      <input type="text" name="name" required placeholder="Source name">

      <label>Type</label>
      <select name="source_type">
        <option value="email">Email</option>
        <option value="rss">RSS</option>
      </select>

      <label>Identifier <span style="color:var(--muted);font-size:0.8rem;">(email address or URL — leave blank to auto-generate)</span></label>
      <input type="text" name="identifier" placeholder="Optional — auto-generated for email">

      <label>AI Instructions <span style="color:var(--muted);font-size:0.8rem;">(context to help the AI extract data)</span></label>
      <textarea name="instructions" rows="4" placeholder="e.g. This email contains upcoming live music events at Farmhouse Restaurant in Stamford, CT."></textarea>

      <button type="submit" class="btn" style="margin-top:1rem;">Create Source</button>
    </form>
  `));
});

adminApp.post('/admin/sources/new', async (c) => {
  const body = await c.req.parseBody();
  const name = (body.name as string || '').trim();
  const sourceType = (body.source_type as string) || 'email';
  let identifier = (body.identifier as string || '').trim().toLowerCase();
  const instructions = (body.instructions as string || '').trim() || null;

  if (!name) return c.redirect('/admin/sources/new');

  // Auto-generate email identifier if blank
  if (!identifier && sourceType === 'email') {
    const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 24);
    identifier = `${slug}-${Date.now().toString(36)}@${LN_DOMAIN}`;
  }

  await pool.query(
    `INSERT INTO ln_sources (source_type, identifier, name, instructions)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source_type, identifier) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, ln_sources.name),
       instructions = COALESCE(EXCLUDED.instructions, ln_sources.instructions),
       updated_at = NOW()`,
    [sourceType, identifier, name, instructions]
  );

  logger.info({ event: 'source_created_via_admin', name, identifier }, 'Source created via admin');
  return c.redirect('/admin/sources');
});

// ── Submissions ─────────────────────────────────────────────────────────────

adminApp.get('/admin/submissions', async (c) => {
  const status = c.req.query('status') || 'pending';
  const { rows } = await pool.query(
    'SELECT * FROM ln_submissions WHERE status = $1 ORDER BY created_at DESC LIMIT 50',
    [status]
  );

  const tabs = ['pending', 'approved', 'dismissed'].map(s =>
    `<a href="/admin/submissions?status=${s}" class="btn ${s === status ? '' : 'btn-outline'}" style="font-size:0.8rem;">${s} (${s === status ? rows.length : ''})</a>`
  ).join(' ');

  const subRows = rows.map(s => `
    <div class="card" style="margin-bottom:1rem;">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:0.5rem;">
        <div>
          <strong>${escHtml(s.original_sender || 'Unknown')}</strong>
          <span style="color:var(--muted);font-size:0.8rem;margin-left:0.5rem;">via ${escHtml(s.submitted_by || '?')}</span>
        </div>
        <span style="font-size:0.75rem;color:var(--muted);">${new Date(s.created_at).toLocaleString()}</span>
      </div>
      <div style="font-style:italic;margin-bottom:0.5rem;">${escHtml(s.original_subject || '(no subject)')}</div>
      <details><summary style="cursor:pointer;font-size:0.8rem;color:var(--muted);">Show email body</summary>
        <pre style="max-height:200px;overflow:auto;font-size:0.75rem;background:#f5f3f0;padding:0.75rem;margin-top:0.5rem;border:1px solid var(--rule);white-space:pre-wrap;">${escHtml(s.raw_body.slice(0, 3000))}</pre>
      </details>
      ${s.status === 'pending' ? `
      <div style="margin-top:1rem;display:flex;gap:0.5rem;">
        <form method="POST" action="/admin/submissions/${s.id}/approve" style="flex:1;">
          <input type="text" name="name" placeholder="Source name" style="width:100%;padding:0.4rem;border:1px solid var(--rule);margin-bottom:0.4rem;font-size:0.85rem;">
          <input type="text" name="instructions" placeholder="AI instructions (optional)" style="width:100%;padding:0.4rem;border:1px solid var(--rule);margin-bottom:0.4rem;font-size:0.85rem;">
          <button type="submit" class="btn" style="font-size:0.8rem;">✅ Approve & Create Source</button>
        </form>
        <form method="POST" action="/admin/submissions/${s.id}/dismiss">
          <button type="submit" class="btn btn-outline" style="font-size:0.8rem;">✕ Dismiss</button>
        </form>
      </div>` : s.admin_notes ? `<div style="margin-top:0.5rem;font-size:0.8rem;color:var(--muted);">Note: ${escHtml(s.admin_notes)}</div>` : ''}
    </div>
  `).join('');

  return c.html(layout('Submissions', `
    <h1>Submissions</h1>
    <div style="margin-bottom:1.5rem;display:flex;gap:0.5rem;">${tabs}</div>
    ${subRows || '<p style="color:var(--muted);text-align:center;padding:2rem;">No submissions</p>'}
  `));
});

adminApp.post('/admin/submissions/:id/approve', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const name = (body.name as string || '').trim() || null;
  const instructions = (body.instructions as string || '').trim() || null;

  // Call the existing API logic
  const resp = await adminApp.request(
    new Request(`http://localhost/api/submissions/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, instructions }),
    })
  );

  // We can't easily call the API internally, so do it inline
  const { rows } = await pool.query('SELECT * FROM ln_submissions WHERE id = $1', [id]);
  if (rows.length === 0 || rows[0].status !== 'pending') return c.redirect('/admin/submissions');

  const sub = rows[0];
  const slug = (sub.original_sender || 'src').split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 20);
  const ingestAddress = `${slug}-${Date.now().toString(36)}@${LN_DOMAIN}`;

  const { rows: srcRows } = await pool.query(
    `INSERT INTO ln_sources (source_type, identifier, name, instructions)
     VALUES ('email', $1, $2, $3) RETURNING *`,
    [ingestAddress, name || sub.original_sender || 'Unknown', instructions]
  );

  await pool.query(
    `UPDATE ln_submissions SET status = 'approved', source_id = $1, reviewed_at = NOW() WHERE id = $2`,
    [srcRows[0].id, id]
  );

  logger.info({ event: 'submission_approved_via_admin', id, source_id: srcRows[0].id }, 'Submission approved via admin');
  return c.redirect('/admin/submissions');
});

adminApp.post('/admin/submissions/:id/dismiss', async (c) => {
  const id = c.req.param('id');
  await pool.query(
    `UPDATE ln_submissions SET status = 'dismissed', reviewed_at = NOW() WHERE id = $1 AND status = 'pending'`,
    [id]
  );
  return c.redirect('/admin/submissions');
});

// ── Ingestions ───────────────────────────────────────────────────────────────

adminApp.get('/admin/ingestions', async (c) => {
  const { rows } = await pool.query(
    `SELECT i.*, s.name AS source_name FROM ln_ingestions i
     LEFT JOIN ln_sources s ON s.id = i.source_id
     ORDER BY i.created_at DESC LIMIT 30`
  );

  const trs = rows.map(i => `
    <tr>
      <td>${i.id}</td>
      <td>${escHtml(i.source_name || '—')}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(i.raw_subject || '—')}</td>
      <td><span class="badge badge-${i.status}">${i.status}</span></td>
      <td>${i.entities_extracted || 0} / ${i.events_extracted || 0}</td>
      <td style="font-size:0.75rem;color:var(--muted);">${new Date(i.created_at).toLocaleString()}</td>
    </tr>
  `).join('');

  return c.html(layout('Ingestions', `
    <h1>Ingestion Log</h1>
    <table>
      <thead><tr><th>#</th><th>Source</th><th>Subject</th><th>Status</th><th>Entities/Events</th><th>Date</th></tr></thead>
      <tbody>${trs || '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:2rem;">No ingestions</td></tr>'}</tbody>
    </table>
  `));
});

// ── Entities ────────────────────────────────────────────────────────────────

adminApp.get('/admin/entities', async (c) => {
  const { rows } = await pool.query('SELECT * FROM ln_entities ORDER BY created_at DESC LIMIT 100');

  const trs = rows.map(e => `
    <tr>
      <td>${e.id}</td>
      <td><strong>${escHtml(e.name)}</strong></td>
      <td>${e.entity_type}</td>
      <td>${e.subtype || '—'}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.8rem;color:var(--muted);">${escHtml(e.description || '—')}</td>
    </tr>
  `).join('');

  return c.html(layout('Entities', `
    <h1>Entities</h1>
    <table>
      <thead><tr><th>#</th><th>Name</th><th>Type</th><th>Subtype</th><th>Description</th></tr></thead>
      <tbody>${trs || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem;">No entities</td></tr>'}</tbody>
    </table>
  `));
});

// ── Events ──────────────────────────────────────────────────────────────────

adminApp.get('/admin/events', async (c) => {
  const { rows } = await pool.query(`
    SELECT e.*, v.name AS venue_name FROM ln_events e
    LEFT JOIN ln_entities v ON v.id = e.venue_id
    ORDER BY e.start_time DESC NULLS LAST LIMIT 100
  `);

  const trs = rows.map(e => `
    <tr>
      <td>${e.id}</td>
      <td><strong>${escHtml(e.title)}</strong></td>
      <td>${e.event_type || '—'}</td>
      <td>${escHtml(e.venue_name || '—')}</td>
      <td>${e.start_time ? new Date(e.start_time).toLocaleDateString() : '—'}</td>
    </tr>
  `).join('');

  return c.html(layout('Events', `
    <h1>Events</h1>
    <table>
      <thead><tr><th>#</th><th>Title</th><th>Type</th><th>Venue</th><th>Date</th></tr></thead>
      <tbody>${trs || '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:2rem;">No events</td></tr>'}</tbody>
    </table>
  `));
});

// ── Layout ──────────────────────────────────────────────────────────────────

function layout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — Stamford Times Admin</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@700;900&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--ink:#1a1a1a;--paper:#faf8f5;--rule:#c8c0b4;--accent:#8b1a1a;--muted:#6b6560;--card-bg:#fff}
    body{font-family:'Inter',sans-serif;background:var(--paper);color:var(--ink);line-height:1.5;min-height:100vh}
    a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}

    .topbar{display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1.5rem;border-bottom:2px solid var(--ink);background:var(--card-bg)}
    .topbar-title{font-family:'Playfair Display',serif;font-weight:900;font-size:1.1rem;color:var(--ink);text-decoration:none}
    .topbar nav{display:flex;gap:1rem;font-size:0.8rem;font-weight:500}
    .topbar nav a{color:var(--muted)}
    .topbar nav a:hover{color:var(--ink)}

    .container{max-width:960px;margin:0 auto;padding:2rem 1.5rem}
    h1{font-family:'Playfair Display',serif;font-size:1.6rem;margin-bottom:1.25rem}
    h2{font-family:'Playfair Display',serif;font-size:1.2rem}

    .card{background:var(--card-bg);border:1px solid var(--rule);padding:1.25rem;border-radius:2px}
    .stats-row{display:flex;gap:1rem;flex-wrap:wrap}
    .stat-box{flex:1;min-width:120px;text-align:center;background:var(--card-bg);border:1px solid var(--rule);padding:1rem 0.5rem;border-radius:2px}
    .stat-n{font-family:'Playfair Display',serif;font-size:1.8rem;font-weight:700;line-height:1}
    .stat-l{font-size:0.68rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);margin-top:0.25rem}

    table{width:100%;border-collapse:collapse;font-size:0.85rem;background:var(--card-bg);border:1px solid var(--rule)}
    th{text-align:left;padding:0.6rem 0.75rem;border-bottom:2px solid var(--ink);font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted)}
    td{padding:0.55rem 0.75rem;border-bottom:1px solid var(--rule);vertical-align:top}
    tr:last-child td{border-bottom:none}

    label{display:block;font-size:0.8rem;font-weight:600;margin:0.75rem 0 0.25rem;letter-spacing:0.03em}
    input[type=text],input[type=password],textarea,select{width:100%;padding:0.55rem;border:1px solid var(--rule);font-family:inherit;font-size:0.85rem;background:var(--paper);border-radius:2px}
    textarea{resize:vertical}

    .btn{display:inline-block;padding:0.5rem 1.2rem;background:var(--ink);color:var(--paper);border:1px solid var(--ink);font-size:0.82rem;font-weight:500;cursor:pointer;border-radius:2px;text-decoration:none;text-align:center;font-family:inherit}
    .btn:hover{background:#333;text-decoration:none}
    .btn-outline{background:transparent;color:var(--ink)}
    .btn-outline:hover{background:var(--ink);color:var(--paper)}

    .badge{font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:2px;font-weight:500;letter-spacing:0.05em}
    .badge-processed{background:#d4edda;color:#155724}.badge-pending{background:#fff3cd;color:#856404}
    .badge-failed{background:#f8d7da;color:#721c24}.badge-skipped{background:#e2e3e5;color:#383d41}

    code{font-size:0.8rem;background:#f0ede8;padding:0.1rem 0.3rem;border-radius:2px}
  </style>
</head>
<body>
  <div class="topbar">
    <a href="/admin" class="topbar-title">Stamford Times Admin</a>
    <nav>
      <a href="/admin">Dashboard</a>
      <a href="/admin/sources">Sources</a>
      <a href="/admin/submissions">Submissions</a>
      <a href="/admin/ingestions">Ingestions</a>
      <a href="/admin/entities">Entities</a>
      <a href="/admin/events">Events</a>
      <a href="/" target="_blank">Site ↗</a>
      <a href="/admin/logout">Logout</a>
    </nav>
  </div>
  <div class="container">${content}</div>
</body>
</html>`;
}

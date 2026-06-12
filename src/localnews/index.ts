import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from '../lib/logger.js';
import { pool } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { extractFromEmail } from './extract.js';

process.on('unhandledRejection', (err) => {
  logger.warn({ err }, 'Caught unhandled promise rejection in localnews');
});

const app = new Hono();

const LN_DOMAIN = process.env.LOCALNEWS_DOMAIN || 'stamfordtimes.com';
const SUBMIT_ADDRESS = `submit@${LN_DOMAIN}`;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Detect if an email is a forward and extract original sender info */
function parseForwardedEmail(subject: string, body: string): { isForward: boolean; originalSender?: string; originalSubject?: string; cleanBody: string } {
  const isForward = /^(fwd?|fw):/i.test(subject.trim());

  if (!isForward) return { isForward: false, cleanBody: body };

  let originalSender: string | undefined;
  let originalSubject: string | undefined;

  // Gmail style: ---------- Forwarded message ---------
  const gmailMatch = body.match(/---------- Forwarded message ---------[\s\S]*?From:\s*(.+?)\n/i);
  if (gmailMatch) originalSender = gmailMatch[1].trim();

  // Outlook style: From: ... Sent: ... To: ... Subject: ...
  const outlookMatch = body.match(/From:\s*(.+?)\r?\n.*?Subject:\s*(.+?)\r?\n/i);
  if (outlookMatch) {
    if (!originalSender) originalSender = outlookMatch[1].trim();
    originalSubject = outlookMatch[2].trim();
  }

  // Apple Mail: Begin forwarded message: From: ...
  const appleMatch = body.match(/Begin forwarded message:[\s\S]*?From:\s*(.+?)\r?\n/i);
  if (appleMatch && !originalSender) originalSender = appleMatch[1].trim();

  // Extract email from "Name <email>" format
  if (originalSender) {
    const emailMatch = originalSender.match(/<([^>]+)>/);
    if (emailMatch) originalSender = emailMatch[1].trim();
  }

  // Clean subject: remove Fwd:/FW: prefix
  const cleanSubject = subject.replace(/^(fwd?|fw):\s*/i, '').trim();
  if (!originalSubject) originalSubject = cleanSubject;

  return { isForward: true, originalSender, originalSubject, cleanBody: body };
}

// ── Static Assets ──────────────────────────────────────────────────────────

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const logoBuffer = readFileSync(join(__dirname, 'logo.png'));

app.get('/logo.png', (c) => {
  c.header('Content-Type', 'image/png');
  c.header('Cache-Control', 'public, max-age=86400');
  return c.body(logoBuffer);
});

// ── Homepage ────────────────────────────────────────────────────────────────

app.get('/', async (c) => {
  // Grab live counts for the holding page
  let entityCount = 0, eventCount = 0, sourceCount = 0;
  try {
    const [e, ev, s] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS c FROM ln_entities'),
      pool.query('SELECT COUNT(*)::int AS c FROM ln_events'),
      pool.query('SELECT COUNT(*)::int AS c FROM ln_sources WHERE active = true'),
    ]);
    entityCount = e.rows[0]?.c || 0;
    eventCount = ev.rows[0]?.c || 0;
    sourceCount = s.rows[0]?.c || 0;
  } catch {}

  // Next 5 upcoming events for a teaser
  let upcomingEvents: any[] = [];
  try {
    const { rows } = await pool.query(`
      SELECT e.title, e.event_type, e.start_time, v.name AS venue_name
      FROM ln_events e
      LEFT JOIN ln_entities v ON v.id = e.venue_id
      WHERE e.start_time >= NOW()
      ORDER BY e.start_time ASC
      LIMIT 5
    `);
    upcomingEvents = rows;
  } catch {}

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stamford Times — Local News, Events & Community</title>
  <meta name="description" content="Stamford Times — your AI-powered civic intelligence platform for local news, events, and community happenings in Stamford, CT.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --ink: #1a1a1a;
      --paper: #faf8f5;
      --rule: #c8c0b4;
      --accent: #8b1a1a;
      --muted: #6b6560;
      --card-bg: #ffffff;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--paper);
      color: var(--ink);
      line-height: 1.6;
      min-height: 100vh;
    }

    /* ── Masthead ────────────────────────────────── */
    .masthead {
      text-align: center;
      padding: 2.5rem 1.5rem 1.5rem;
      border-bottom: 3px double var(--rule);
    }
    .masthead img {
      max-width: min(90vw, 520px);
      height: auto;
      margin-bottom: 0.75rem;
      padding: 1.25rem 2rem;
      background: var(--card-bg);
      border: 1px solid var(--rule);
    }
    .dateline {
      font-family: 'Inter', sans-serif;
      font-size: 0.78rem;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--muted);
      margin-top: 0.5rem;
    }
    .edition-bar {
      display: flex;
      justify-content: center;
      gap: 2rem;
      padding: 0.5rem 1.5rem;
      font-size: 0.72rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
      border-bottom: 1px solid var(--rule);
    }

    /* ── Main ────────────────────────────────────── */
    .container {
      max-width: 820px;
      margin: 0 auto;
      padding: 2.5rem 1.5rem 4rem;
    }

    /* ── Holding headline ────────────────────────── */
    .headline {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: clamp(1.8rem, 5vw, 2.8rem);
      font-weight: 900;
      line-height: 1.15;
      letter-spacing: -0.02em;
      text-align: center;
      margin-bottom: 1rem;
    }
    .subhead {
      font-family: 'Playfair Display', Georgia, serif;
      font-style: italic;
      font-size: 1.1rem;
      text-align: center;
      color: var(--muted);
      margin-bottom: 2rem;
    }

    .rule { border: none; border-top: 1px solid var(--rule); margin: 2rem 0; }
    .rule-double { border: none; border-top: 3px double var(--rule); margin: 2rem 0; }

    /* ── Stats row ───────────────────────────────── */
    .stats {
      display: flex;
      justify-content: center;
      gap: 2.5rem;
      flex-wrap: wrap;
      margin: 2rem 0;
    }
    .stat {
      text-align: center;
    }
    .stat-num {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 2.2rem;
      font-weight: 700;
      color: var(--accent);
      line-height: 1;
    }
    .stat-label {
      font-size: 0.7rem;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--muted);
      margin-top: 0.25rem;
    }

    /* ── Upcoming events ─────────────────────────── */
    .events-header {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 1.1rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      text-align: center;
      margin-bottom: 1.25rem;
    }
    .event-list {
      list-style: none;
    }
    .event-item {
      display: flex;
      align-items: baseline;
      gap: 1rem;
      padding: 0.65rem 0;
      border-bottom: 1px solid var(--rule);
      font-size: 0.9rem;
    }
    .event-item:last-child { border-bottom: none; }
    .event-date {
      flex-shrink: 0;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      color: var(--muted);
      min-width: 90px;
    }
    .event-type {
      flex-shrink: 0;
      font-size: 0.62rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      background: var(--ink);
      color: var(--paper);
      padding: 0.15rem 0.5rem;
      border-radius: 2px;
      font-weight: 500;
    }
    .event-title {
      font-family: 'Playfair Display', Georgia, serif;
      font-weight: 700;
    }
    .event-venue {
      color: var(--muted);
      font-size: 0.82rem;
    }
    .event-venue::before { content: '— '; }
    .no-events {
      text-align: center;
      color: var(--muted);
      font-style: italic;
      padding: 1.5rem 0;
    }

    /* ── Coming soon notice ──────────────────────── */
    .notice {
      text-align: center;
      padding: 2rem 1.5rem;
      margin: 2rem 0;
      border: 1px solid var(--rule);
      background: var(--card-bg);
    }
    .notice h3 {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 1.05rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }
    .notice p {
      font-size: 0.85rem;
      color: var(--muted);
      max-width: 480px;
      margin: 0 auto;
    }

    /* ── Footer ──────────────────────────────────── */
    .footer {
      text-align: center;
      padding: 1.5rem;
      font-size: 0.7rem;
      color: var(--muted);
      border-top: 1px solid var(--rule);
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .footer a { color: var(--accent); text-decoration: none; }
    .footer a:hover { text-decoration: underline; }

    /* ── Animation ───────────────────────────────── */
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate { animation: fadeUp 0.6s ease-out both; }
    .delay-1 { animation-delay: 0.1s; }
    .delay-2 { animation-delay: 0.2s; }
    .delay-3 { animation-delay: 0.35s; }
    .delay-4 { animation-delay: 0.5s; }

    @media (max-width: 600px) {
      .stats { gap: 1.5rem; }
      .event-item { flex-wrap: wrap; gap: 0.4rem; }
      .edition-bar { gap: 1rem; flex-wrap: wrap; }
    }
  </style>
</head>
<body>
  <header class="masthead animate">
    <img src="/logo.png" alt="Stamford Times">
    <div class="dateline">${dateStr}</div>
  </header>
  <div class="edition-bar animate delay-1">
    <span>Digital Edition</span>
    <span>·</span>
    <span>Stamford, Connecticut</span>
    <span>·</span>
    <span>AI-Powered Civic Intelligence</span>
  </div>

  <main class="container">
    <h1 class="headline animate delay-1">Your Community, Connected.</h1>
    <p class="subhead animate delay-2">
      AI-curated local events, people, places &amp; stories — coming soon.
    </p>

    <hr class="rule">

    ${entityCount + eventCount > 0 ? `
    <div class="stats animate delay-2">
      <div class="stat">
        <div class="stat-num">${entityCount.toLocaleString()}</div>
        <div class="stat-label">People, Places &amp; Things</div>
      </div>
      <div class="stat">
        <div class="stat-num">${eventCount.toLocaleString()}</div>
        <div class="stat-label">Events Tracked</div>
      </div>
      <div class="stat">
        <div class="stat-num">${sourceCount.toLocaleString()}</div>
        <div class="stat-label">Active Sources</div>
      </div>
    </div>
    <hr class="rule">
    ` : ''}

    ${upcomingEvents.length > 0 ? `
    <div class="animate delay-3">
      <div class="events-header">Upcoming Events</div>
      <ul class="event-list">
        ${upcomingEvents.map(ev => {
          const d = ev.start_time ? new Date(ev.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
          return `<li class="event-item">
            <span class="event-date">${d}</span>
            ${ev.event_type ? `<span class="event-type">${ev.event_type}</span>` : ''}
            <span>
              <span class="event-title">${ev.title}</span>
              ${ev.venue_name ? `<span class="event-venue">${ev.venue_name}</span>` : ''}
            </span>
          </li>`;
        }).join('')}
      </ul>
    </div>
    <hr class="rule-double">
    ` : ''}

    <div class="notice animate delay-3">
      <h3>The Stamford Times is Building Something New</h3>
      <p>We're using AI to connect the dots between local events, businesses, people, and community happenings — creating a living map of civic life in Stamford.</p>
    </div>

    <div class="notice animate delay-4" style="border-style: dashed;">
      <h3>Know a Great Newsletter?</h3>
      <p>Forward any Stamford-area newsletter to <strong>${SUBMIT_ADDRESS}</strong> and our editors will review it as a potential source.</p>
    </div>
  </main>

  <footer class="footer">
    <p>Stamford Times &mdash; Est. 1876 &mdash; Powered by <a href="https://open.news">Open News</a></p>
  </footer>
</body>
</html>`);
});

// ── Health ──────────────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ status: 'ok', service: 'localnews', domain: LN_DOMAIN }));

// ── SendGrid Inbound Parse Webhook ──────────────────────────────────────────
// SendGrid POSTs multipart/form-data with: from, to, subject, text, html, etc.

app.post('/api/ingest/email', async (c) => {
  try {
    const body = await c.req.parseBody({ all: true });

    const from = (typeof body.from === 'string' ? body.from : '') || '';
    const to = (typeof body.to === 'string' ? body.to : '') || '';
    const subject = (typeof body.subject === 'string' ? body.subject : '') || '';
    const textBody = (typeof body.text === 'string' ? body.text : '') || '';
    const htmlBody = (typeof body.html === 'string' ? body.html : '') || '';

    // Extract sender email from "Name <email>" format
    const senderMatch = from.match(/<([^>]+)>/) || [null, from];
    const senderEmail = (senderMatch[1] || from).trim().toLowerCase();

    const content = textBody || htmlBody;
    if (!content.trim()) {
      logger.warn({ from, subject }, 'Empty email body received');
      return c.json({ status: 'skipped', reason: 'empty body' });
    }

    // Check if this is a community-forwarded submission (always to submit@ address)
    const isSubmitAddress = to.toLowerCase().includes(SUBMIT_ADDRESS);
    const fwd = parseForwardedEmail(subject, content);

    if (isSubmitAddress) {
      // Always store submit@ emails as submissions for admin review
      await pool.query(
        `INSERT INTO ln_submissions (submitted_by, original_sender, original_subject, raw_body)
         VALUES ($1, $2, $3, $4)`,
        [senderEmail, fwd.originalSender || senderEmail, fwd.originalSubject || subject, content]
      );

      logger.info({
        event: 'submission_received',
        submitted_by: senderEmail,
        original_sender: fwd.originalSender,
        original_subject: fwd.originalSubject,
      }, 'Community submission received for admin review');

      return c.json({ status: 'submitted', message: 'Forwarded email received for review' });
    }

    // Find matching source (by sender email or to-address)
    const { rows: sourceRows } = await pool.query(
      `SELECT * FROM ln_sources WHERE source_type = 'email' AND active = TRUE
       AND (identifier = $1 OR $2 LIKE '%' || identifier || '%')`,
      [senderEmail, to.toLowerCase()]
    );

    const source = sourceRows[0] || null;

    // Store ingestion
    const { rows: ingestions } = await pool.query(
      `INSERT INTO ln_ingestions (source_id, raw_subject, raw_body, sender, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
      [source?.id || null, subject, content, senderEmail]
    );

    const ingestionId = ingestions[0].id;

    logger.info({
      event: 'email_received',
      ingestion_id: ingestionId,
      from: senderEmail,
      subject,
      source_id: source?.id,
      body_length: content.length,
    }, 'Email ingestion received');

    // Process asynchronously
    setImmediate(async () => {
      try {
        await extractFromEmail(ingestionId, subject, content, source);
      } catch (err) {
        logger.error({ err, ingestion_id: ingestionId }, 'Email extraction failed');
        await pool.query(
          `UPDATE ln_ingestions SET status = 'failed', error = $1, processed_at = NOW() WHERE id = $2`,
          [String(err), ingestionId]
        );
      }
    });

    return c.json({ status: 'accepted', ingestion_id: ingestionId });
  } catch (err) {
    logger.error({ err }, 'Email webhook error');
    return c.json({ status: 'error' }, 500);
  }
});

// ── Source Management ───────────────────────────────────────────────────────

app.get('/api/sources', async (c) => {
  const { rows } = await pool.query('SELECT * FROM ln_sources ORDER BY created_at DESC');
  return c.json({ sources: rows });
});

app.post('/api/sources', async (c) => {
  const { source_type, identifier, name, instructions } = await c.req.json();
  if (!identifier?.trim()) return c.json({ error: 'identifier is required' }, 400);

  const { rows } = await pool.query(
    `INSERT INTO ln_sources (source_type, identifier, name, instructions)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source_type, identifier) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, ln_sources.name),
       instructions = COALESCE(EXCLUDED.instructions, ln_sources.instructions),
       updated_at = NOW()
     RETURNING *`,
    [source_type || 'email', identifier.trim().toLowerCase(), name || null, instructions || null]
  );

  logger.info({ event: 'source_created', source: rows[0] }, 'Source created');
  return c.json({ source: rows[0] });
});

app.put('/api/sources/:id', async (c) => {
  const id = c.req.param('id');
  const { name, instructions, active } = await c.req.json();

  const { rows } = await pool.query(
    `UPDATE ln_sources SET
       name = COALESCE($1, name),
       instructions = COALESCE($2, instructions),
       active = COALESCE($3, active),
       updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [name, instructions, active, id]
  );

  if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ source: rows[0] });
});

// ── Entities ────────────────────────────────────────────────────────────────

app.get('/api/entities', async (c) => {
  const type = c.req.query('type');
  const subtype = c.req.query('subtype');
  const search = c.req.query('q');

  let query = 'SELECT * FROM ln_entities WHERE 1=1';
  const params: any[] = [];

  if (type) {
    params.push(type);
    query += ` AND entity_type = $${params.length}`;
  }
  if (subtype) {
    params.push(subtype);
    query += ` AND subtype = $${params.length}`;
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    query += ` AND name_normalized LIKE $${params.length}`;
  }

  query += ' ORDER BY name ASC LIMIT 200';

  const { rows } = await pool.query(query, params);
  return c.json({ entities: rows });
});

// ── Events ──────────────────────────────────────────────────────────────────

app.get('/api/events', async (c) => {
  const upcoming = c.req.query('upcoming') !== 'false';
  const eventType = c.req.query('event_type');
  const limit = Math.min(Number(c.req.query('limit') || 50), 200);

  let query = `
    SELECT e.*, v.name AS venue_name, v.address AS venue_address
    FROM ln_events e
    LEFT JOIN ln_entities v ON v.id = e.venue_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (upcoming) {
    query += ` AND (e.start_time >= NOW() OR e.start_time IS NULL)`;
  }
  if (eventType) {
    params.push(eventType);
    query += ` AND e.event_type = $${params.length}`;
  }

  params.push(limit);
  query += ` ORDER BY e.start_time ASC NULLS LAST LIMIT $${params.length}`;

  const { rows } = await pool.query(query, params);

  // Attach performers
  for (const event of rows) {
    const { rows: performers } = await pool.query(
      `SELECT ee.role, ent.id, ent.name, ent.entity_type, ent.subtype
       FROM ln_event_entities ee
       JOIN ln_entities ent ON ent.id = ee.entity_id
       WHERE ee.event_id = $1`,
      [event.id]
    );
    event.performers = performers;
  }

  return c.json({ events: rows });
});

// ── Ontology: Entity Relations ──────────────────────────────────────────────

app.get('/api/entities/:id/relations', async (c) => {
  const id = c.req.param('id');

  const { rows } = await pool.query(
    `SELECT
       er.relation_type, er.from_entity_id, er.to_entity_id,
       ef.name AS from_name, ef.entity_type AS from_type,
       et.name AS to_name, et.entity_type AS to_type
     FROM ln_entity_relations er
     JOIN ln_entities ef ON ef.id = er.from_entity_id
     JOIN ln_entities et ON et.id = er.to_entity_id
     WHERE er.from_entity_id = $1 OR er.to_entity_id = $1
     ORDER BY er.relation_type`,
    [id]
  );

  return c.json({ relations: rows });
});

// Full entity graph for an entity (entity + its relations + their events)
app.get('/api/entities/:id/graph', async (c) => {
  const id = c.req.param('id');

  // Entity itself
  const { rows: entity } = await pool.query('SELECT * FROM ln_entities WHERE id = $1', [id]);
  if (entity.length === 0) return c.json({ error: 'Not found' }, 404);

  // Relations
  const { rows: relations } = await pool.query(
    `SELECT er.*, ef.name AS from_name, et.name AS to_name
     FROM ln_entity_relations er
     JOIN ln_entities ef ON ef.id = er.from_entity_id
     JOIN ln_entities et ON et.id = er.to_entity_id
     WHERE er.from_entity_id = $1 OR er.to_entity_id = $1`,
    [id]
  );

  // Events this entity is involved in
  const { rows: events } = await pool.query(
    `SELECT DISTINCT e.id, e.title, e.event_type, e.start_time, e.description,
            v.name AS venue_name, ee.role
     FROM ln_event_entities ee
     JOIN ln_events e ON e.id = ee.event_id
     LEFT JOIN ln_entities v ON v.id = e.venue_id
     WHERE ee.entity_id = $1
     ORDER BY e.start_time DESC NULLS LAST LIMIT 50`,
    [id]
  );

  // Events at this entity (if it's a venue)
  const { rows: hostedEvents } = await pool.query(
    `SELECT e.id, e.title, e.event_type, e.start_time, e.description
     FROM ln_events e
     WHERE e.venue_id = $1
     ORDER BY e.start_time DESC NULLS LAST LIMIT 50`,
    [id]
  );

  return c.json({
    entity: entity[0],
    relations,
    events,
    hosted_events: hostedEvents,
  });
});

// ── Ontology: Event Relations ───────────────────────────────────────────────

app.get('/api/events/:id/related', async (c) => {
  const id = c.req.param('id');

  const { rows } = await pool.query(
    `SELECT
       er.relation_type,
       CASE WHEN er.from_event_id = $1::bigint THEN 'outgoing' ELSE 'incoming' END AS direction,
       e.id, e.title, e.event_type, e.start_time, e.description,
       v.name AS venue_name
     FROM ln_event_relations er
     JOIN ln_events e ON e.id = CASE WHEN er.from_event_id = $1::bigint THEN er.to_event_id ELSE er.from_event_id END
     LEFT JOIN ln_entities v ON v.id = e.venue_id
     WHERE er.from_event_id = $1 OR er.to_event_id = $1`,
    [id]
  );

  return c.json({ related_events: rows });
});

// ── Ontology: Event Types Summary ───────────────────────────────────────────

app.get('/api/ontology/event-types', async (c) => {
  const { rows } = await pool.query(
    `SELECT event_type, COUNT(*)::int AS count
     FROM ln_events
     WHERE event_type IS NOT NULL
     GROUP BY event_type
     ORDER BY count DESC`
  );
  return c.json({ event_types: rows });
});

// ── Ontology: Relation Types Summary ────────────────────────────────────────

app.get('/api/ontology/stats', async (c) => {
  const [entities, events, entityRels, eventRels, sources, ingestions] = await Promise.all([
    pool.query('SELECT entity_type, COUNT(*)::int AS count FROM ln_entities GROUP BY entity_type ORDER BY count DESC'),
    pool.query('SELECT event_type, COUNT(*)::int AS count FROM ln_events WHERE event_type IS NOT NULL GROUP BY event_type ORDER BY count DESC'),
    pool.query('SELECT relation_type, COUNT(*)::int AS count FROM ln_entity_relations GROUP BY relation_type ORDER BY count DESC'),
    pool.query('SELECT relation_type, COUNT(*)::int AS count FROM ln_event_relations GROUP BY relation_type ORDER BY count DESC'),
    pool.query('SELECT COUNT(*)::int AS count FROM ln_sources WHERE active = true'),
    pool.query("SELECT status, COUNT(*)::int AS count FROM ln_ingestions GROUP BY status"),
  ]);

  return c.json({
    entities: entities.rows,
    event_types: events.rows,
    entity_relations: entityRels.rows,
    event_relations: eventRels.rows,
    active_sources: sources.rows[0]?.count || 0,
    ingestions: ingestions.rows,
  });
});

// ── Ingestions (audit) ──────────────────────────────────────────────────────

app.get('/api/ingestions', async (c) => {
  const { rows } = await pool.query(
    `SELECT i.*, s.name AS source_name, s.identifier AS source_identifier
     FROM ln_ingestions i
     LEFT JOIN ln_sources s ON s.id = i.source_id
     ORDER BY i.created_at DESC LIMIT 50`
  );
  return c.json({ ingestions: rows });
});

// Reprocess a failed ingestion
app.post('/api/ingestions/:id/reprocess', async (c) => {
  const id = c.req.param('id');
  const { rows } = await pool.query(
    'SELECT i.*, s.instructions FROM ln_ingestions i LEFT JOIN ln_sources s ON s.id = i.source_id WHERE i.id = $1',
    [id]
  );
  if (rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const ingestion = rows[0];
  await pool.query("UPDATE ln_ingestions SET status = 'pending' WHERE id = $1", [id]);

  setImmediate(async () => {
    try {
      await extractFromEmail(
        ingestion.id,
        ingestion.raw_subject,
        ingestion.raw_body,
        ingestion.source_id ? { id: ingestion.source_id, instructions: ingestion.instructions } : null
      );
    } catch (err) {
      logger.error({ err, ingestion_id: id }, 'Reprocessing failed');
    }
  });

  return c.json({ status: 'reprocessing' });
});

// ── Submissions (admin review) ──────────────────────────────────────────────

app.get('/api/submissions', async (c) => {
  const status = c.req.query('status') || 'pending';
  const { rows } = await pool.query(
    `SELECT * FROM ln_submissions WHERE status = $1 ORDER BY created_at DESC LIMIT 50`,
    [status]
  );
  return c.json({ submissions: rows });
});

app.get('/api/submissions/:id', async (c) => {
  const { rows } = await pool.query('SELECT * FROM ln_submissions WHERE id = $1', [c.req.param('id')]);
  if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ submission: rows[0] });
});

// Approve a submission: creates a source with a generated ingest address
app.post('/api/submissions/:id/approve', async (c) => {
  const id = c.req.param('id');
  const { rows } = await pool.query('SELECT * FROM ln_submissions WHERE id = $1', [id]);
  if (rows.length === 0) return c.json({ error: 'Not found' }, 404);
  if (rows[0].status !== 'pending') return c.json({ error: 'Already reviewed' }, 400);

  const sub = rows[0];
  const { name, instructions } = await c.req.json().catch(() => ({ name: null, instructions: null }));

  // Generate a unique ingest address for this source
  const slug = sub.original_sender
    ? sub.original_sender.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 20)
    : 'src';
  const ingestAddress = `${slug}-${Date.now().toString(36)}@${LN_DOMAIN}`;

  // Create source
  const { rows: sourceRows } = await pool.query(
    `INSERT INTO ln_sources (source_type, identifier, name, instructions)
     VALUES ('email', $1, $2, $3) RETURNING *`,
    [ingestAddress, name || sub.original_sender || 'Unknown Source', instructions || null]
  );

  // Mark submission as approved
  await pool.query(
    `UPDATE ln_submissions SET status = 'approved', source_id = $1, reviewed_at = NOW() WHERE id = $2`,
    [sourceRows[0].id, id]
  );

  // Also process the original email content as the first ingestion
  const { rows: ingestions } = await pool.query(
    `INSERT INTO ln_ingestions (source_id, raw_subject, raw_body, sender, status)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
    [sourceRows[0].id, sub.original_subject, sub.raw_body, sub.original_sender]
  );

  setImmediate(async () => {
    try {
      await extractFromEmail(ingestions[0].id, sub.original_subject, sub.raw_body, sourceRows[0]);
    } catch (err) {
      logger.error({ err }, 'Extraction from approved submission failed');
    }
  });

  logger.info({
    event: 'submission_approved',
    submission_id: id,
    source_id: sourceRows[0].id,
    ingest_address: ingestAddress,
  }, 'Submission approved, source created');

  return c.json({
    source: sourceRows[0],
    ingest_address: ingestAddress,
    message: `Source created. Subscribe to the newsletter using: ${ingestAddress}`,
  });
});

app.post('/api/submissions/:id/dismiss', async (c) => {
  const id = c.req.param('id');
  const { notes } = await c.req.json().catch(() => ({ notes: null }));

  const { rowCount } = await pool.query(
    `UPDATE ln_submissions SET status = 'dismissed', admin_notes = $1, reviewed_at = NOW() WHERE id = $2 AND status = 'pending'`,
    [notes || null, id]
  );

  if (rowCount === 0) return c.json({ error: 'Not found or already reviewed' }, 404);
  return c.json({ status: 'dismissed' });
});

// ── Error Handling ──────────────────────────────────────────────────────────

app.onError((err, c) => {
  logger.error({ err, path: c.req.path }, 'localnews request error');
  return c.json({ error: 'Internal error' }, 500);
});

// ── Start ───────────────────────────────────────────────────────────────────

const LN_PORT = Number(process.env.LOCALNEWS_PORT) || 5000;

async function start() {
  await runMigrations();
  serve({ fetch: app.fetch, port: LN_PORT }, () => {
    logger.info({ port: LN_PORT, domain: LN_DOMAIN }, 'localnews server started');
  });
}

start().catch((err) => {
  logger.error({ err }, 'localnews startup failed');
  process.exit(1);
});

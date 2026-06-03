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

    // Find matching source (by sender email)
    const { rows: sources } = await pool.query(
      `SELECT * FROM ln_sources WHERE source_type = 'email' AND active = TRUE
       AND (identifier = $1 OR $2 LIKE '%' || identifier || '%')`,
      [senderEmail, to.toLowerCase()]
    );

    const source = sources[0] || null;

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

    // Process asynchronously (don't hold up the webhook response)
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
  const limit = Math.min(Number(c.req.query('limit') || 50), 200);

  let query = `
    SELECT e.*, v.name AS venue_name, v.address AS venue_address
    FROM ln_events e
    LEFT JOIN ln_entities v ON v.id = e.venue_id
  `;

  if (upcoming) {
    query += ` WHERE e.start_time >= NOW() OR e.start_time IS NULL`;
  }

  query += ` ORDER BY e.start_time ASC NULLS LAST LIMIT $1`;

  const { rows } = await pool.query(query, [limit]);

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

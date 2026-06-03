import { pool } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { llm } from '../services/llm.js';
import type { LLMMessage } from '../services/llm.js';

interface SourceContext {
  id: number | bigint;
  instructions?: string | null;
}

interface ExtractedEntity {
  name: string;
  entity_type: 'person' | 'place' | 'thing';
  subtype?: string;
  description?: string;
  address?: string;
  website?: string;
}

interface ExtractedEvent {
  title: string;
  description?: string;
  venue_name?: string;
  start_date?: string;   // ISO 8601
  end_date?: string;
  all_day?: boolean;
  performers?: string[];  // entity names
  metadata?: Record<string, any>;
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  events: ExtractedEvent[];
}

const EXTRACTION_PROMPT = `You are an AI agent that extracts structured data from emails about local events, businesses, and community activities.

Given an email, extract:

1. **Entities** — people (musicians, artists, speakers, individuals), places (restaurants, venues, parks, businesses), and things (products, services)
2. **Events** — performances, shows, dinners, classes, meetups, sales, openings

Return ONLY valid JSON with this exact structure (no markdown fences, no explanation):
{
  "entities": [
    {
      "name": "Exact Name",
      "entity_type": "person|place|thing",
      "subtype": "band|individual|artist|speaker|restaurant|venue|bar|park|business|product|service",
      "description": "brief description if available",
      "address": "street address if mentioned",
      "website": "URL if mentioned"
    }
  ],
  "events": [
    {
      "title": "Event Title",
      "description": "brief description",
      "venue_name": "name of the place (must match an entity name above)",
      "start_date": "2026-06-15T20:00:00",
      "end_date": "2026-06-15T23:00:00",
      "all_day": false,
      "performers": ["Artist Name"],
      "metadata": { "price": "$20", "tickets_url": "..." }
    }
  ]
}

Rules:
- Extract ALL events and entities mentioned, not just the first
- Use exact names as written (proper capitalization)
- For dates, use ISO 8601 format. If only a date is given, use midnight. If no year, assume current year.
- If a venue is mentioned, include it as both an entity and in the event's venue_name
- For recurring events, create one entry per occurrence if specific dates are listed
- If the email is not about events/entities (e.g. spam, unsubscribe notice), return {"entities":[],"events":[]}
- Do NOT invent information that isn't in the email`;

/**
 * Process an ingested email and extract entities/events using LLM
 */
export async function extractFromEmail(
  ingestionId: number | bigint,
  subject: string | null,
  body: string,
  source: SourceContext | null
): Promise<void> {
  const startTime = Date.now();

  // Build prompt with source-specific instructions
  let userPrompt = '';
  if (source?.instructions) {
    userPrompt += `CONTEXT FROM SOURCE OWNER: ${source.instructions}\n\n`;
  }
  if (subject) {
    userPrompt += `Subject: ${subject}\n\n`;
  }
  userPrompt += `Email body:\n${body.slice(0, 12000)}`; // Cap to avoid token explosion

  const messages: LLMMessage[] = [
    { role: 'system', content: EXTRACTION_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  const response = await llm.complete(messages, { maxTokens: 4096 });
  let resultText = response.text.trim();

  // Strip markdown fences if present
  resultText = resultText.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '');

  let result: ExtractionResult;
  try {
    result = JSON.parse(resultText);
  } catch (err) {
    logger.error({ err, raw: resultText.slice(0, 500) }, 'Failed to parse LLM extraction output');
    await pool.query(
      `UPDATE ln_ingestions SET status = 'failed', error = 'Invalid JSON from LLM', processed_at = NOW(),
       llm_provider = $2, llm_model = $3, input_tokens = $4, output_tokens = $5
       WHERE id = $1`,
      [ingestionId, response.provider, response.model, response.inputTokens, response.outputTokens]
    );
    return;
  }

  if (!result.entities) result.entities = [];
  if (!result.events) result.events = [];

  // Skip if nothing extracted
  if (result.entities.length === 0 && result.events.length === 0) {
    await pool.query(
      `UPDATE ln_ingestions SET status = 'skipped', processed_at = NOW(),
       llm_provider = $2, llm_model = $3, input_tokens = $4, output_tokens = $5
       WHERE id = $1`,
      [ingestionId, response.provider, response.model, response.inputTokens, response.outputTokens]
    );
    logger.info({ ingestion_id: ingestionId }, 'No entities or events extracted');
    return;
  }

  // ── Upsert Entities ─────────────────────────────────────────────────────
  const entityNameToId = new Map<string, bigint>();

  for (const ent of result.entities) {
    if (!ent.name?.trim()) continue;

    const normalized = ent.name.trim().toLowerCase();

    // Check for existing entity (fuzzy match on normalized name + type)
    const { rows: existing } = await pool.query(
      `SELECT id, name FROM ln_entities
       WHERE name_normalized = $1 AND entity_type = $2
       LIMIT 1`,
      [normalized, ent.entity_type]
    );

    let entityId: bigint;
    if (existing.length > 0) {
      entityId = existing[0].id;
      logger.debug({ name: ent.name, id: entityId }, 'Entity already exists, skipping');
    } else {
      // Also check for near-duplicates (contains match)
      const { rows: nearMatch } = await pool.query(
        `SELECT id, name FROM ln_entities
         WHERE entity_type = $1
         AND (name_normalized = $2
              OR name_normalized LIKE $3
              OR $2 LIKE '%' || name_normalized || '%')
         LIMIT 1`,
        [ent.entity_type, normalized, `%${normalized}%`]
      );

      if (nearMatch.length > 0) {
        entityId = nearMatch[0].id;
        logger.debug({ name: ent.name, matched: nearMatch[0].name, id: entityId }, 'Near-duplicate entity found');
      } else {
        const { rows: inserted } = await pool.query(
          `INSERT INTO ln_entities (entity_type, subtype, name, name_normalized, description, address, website)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [ent.entity_type, ent.subtype || null, ent.name.trim(), normalized,
           ent.description || null, ent.address || null, ent.website || null]
        );
        entityId = inserted[0].id;
        logger.info({ name: ent.name, type: ent.entity_type, id: entityId }, 'Entity created');
      }
    }

    entityNameToId.set(normalized, entityId);
  }

  // ── Upsert Events ───────────────────────────────────────────────────────
  let eventsCreated = 0;

  for (const evt of result.events) {
    if (!evt.title?.trim()) continue;

    const normalizedTitle = evt.title.trim().toLowerCase();
    const startTime = evt.start_date ? new Date(evt.start_date) : null;

    // Check for duplicate event (same title + same date)
    if (startTime && !isNaN(startTime.getTime())) {
      const { rows: dupCheck } = await pool.query(
        `SELECT id FROM ln_events
         WHERE title_normalized = $1
         AND start_time::date = $2::date
         LIMIT 1`,
        [normalizedTitle, startTime.toISOString()]
      );

      if (dupCheck.length > 0) {
        logger.debug({ title: evt.title, date: startTime.toISOString() }, 'Duplicate event, skipping');
        continue;
      }
    }

    // Resolve venue
    let venueId: bigint | null = null;
    if (evt.venue_name) {
      const venueNorm = evt.venue_name.trim().toLowerCase();
      venueId = entityNameToId.get(venueNorm) || null;

      if (!venueId) {
        // Try to find by name in DB
        const { rows: venueRows } = await pool.query(
          `SELECT id FROM ln_entities WHERE name_normalized = $1 AND entity_type = 'place' LIMIT 1`,
          [venueNorm]
        );
        if (venueRows.length > 0) venueId = venueRows[0].id;
      }
    }

    const endTime = evt.end_date ? new Date(evt.end_date) : null;

    const { rows: eventRows } = await pool.query(
      `INSERT INTO ln_events (title, title_normalized, description, venue_id, start_time, end_time, all_day, source_ingestion_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        evt.title.trim(), normalizedTitle,
        evt.description || null, venueId,
        startTime && !isNaN(startTime.getTime()) ? startTime.toISOString() : null,
        endTime && !isNaN(endTime.getTime()) ? endTime.toISOString() : null,
        evt.all_day || false,
        ingestionId,
        JSON.stringify(evt.metadata || {}),
      ]
    );

    const eventId = eventRows[0].id;
    eventsCreated++;

    // Link performers
    if (evt.performers && evt.performers.length > 0) {
      for (const performerName of evt.performers) {
        const perfNorm = performerName.trim().toLowerCase();
        const perfId = entityNameToId.get(perfNorm);
        if (perfId) {
          await pool.query(
            `INSERT INTO ln_event_entities (event_id, entity_id, role)
             VALUES ($1, $2, 'performer')
             ON CONFLICT DO NOTHING`,
            [eventId, perfId]
          );
        }
      }
    }

    logger.info({ title: evt.title, event_id: eventId, venue_id: venueId }, 'Event created');
  }

  // ── Update ingestion status ─────────────────────────────────────────────
  await pool.query(
    `UPDATE ln_ingestions SET
       status = 'processed',
       entities_extracted = $2,
       events_extracted = $3,
       llm_provider = $4,
       llm_model = $5,
       input_tokens = $6,
       output_tokens = $7,
       processed_at = NOW()
     WHERE id = $1`,
    [ingestionId, entityNameToId.size, eventsCreated,
     response.provider, response.model, response.inputTokens, response.outputTokens]
  );

  logger.info({
    event: 'extraction_complete',
    ingestion_id: ingestionId,
    entities: entityNameToId.size,
    events: eventsCreated,
    duration_ms: Date.now() - (startTime as number),
    tokens: { input: response.inputTokens, output: response.outputTokens },
  }, 'Email extraction complete');
}

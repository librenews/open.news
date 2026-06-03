-- Local news: persons, places, things, events
-- Flexible entity model for stamfordtimes.com (configurable domain)

-- Sources: email addresses, RSS feeds, etc. that provide data
CREATE TABLE IF NOT EXISTS ln_sources (
  id           BIGSERIAL PRIMARY KEY,
  source_type  TEXT NOT NULL DEFAULT 'email',     -- email, rss, sms, web
  identifier   TEXT NOT NULL,                     -- email address, URL, phone
  name         TEXT,                              -- human label
  instructions TEXT,                              -- AI hints: "this email contains events for Farmhouse Restaurant"
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_type, identifier)
);

-- Ingestions: raw content received, audit trail
CREATE TABLE IF NOT EXISTS ln_ingestions (
  id           BIGSERIAL PRIMARY KEY,
  source_id    BIGINT REFERENCES ln_sources(id),
  raw_subject  TEXT,
  raw_body     TEXT NOT NULL,
  sender       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending, processed, failed, skipped
  error        TEXT,
  entities_extracted INT DEFAULT 0,
  events_extracted   INT DEFAULT 0,
  llm_provider TEXT,
  llm_model    TEXT,
  input_tokens INT,
  output_tokens INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ln_ingestions_status ON ln_ingestions(status);
CREATE INDEX IF NOT EXISTS idx_ln_ingestions_source ON ln_ingestions(source_id, created_at DESC);

-- Entities: persons, places, things
CREATE TABLE IF NOT EXISTS ln_entities (
  id           BIGSERIAL PRIMARY KEY,
  entity_type  TEXT NOT NULL,                     -- person, place, thing
  subtype      TEXT,                              -- individual, band, business, restaurant, park, venue, etc.
  name         TEXT NOT NULL,
  name_normalized TEXT NOT NULL,                  -- lowercase, trimmed for dedup
  description  TEXT,
  address      TEXT,
  latitude     DOUBLE PRECISION,
  longitude    DOUBLE PRECISION,
  website      TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',       -- flexible fields
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ln_entities_type ON ln_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_ln_entities_name ON ln_entities(name_normalized);
CREATE INDEX IF NOT EXISTS idx_ln_entities_subtype ON ln_entities(entity_type, subtype);

-- Events: occurrences linking entities to times and places
CREATE TABLE IF NOT EXISTS ln_events (
  id           BIGSERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  title_normalized TEXT NOT NULL,                 -- lowercase for dedup
  description  TEXT,
  venue_id     BIGINT REFERENCES ln_entities(id), -- place where it happens
  start_time   TIMESTAMPTZ,
  end_time     TIMESTAMPTZ,
  all_day      BOOLEAN NOT NULL DEFAULT FALSE,
  source_ingestion_id BIGINT REFERENCES ln_ingestions(id),
  metadata     JSONB NOT NULL DEFAULT '{}',       -- price, tickets, age restriction, etc.
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ln_events_start ON ln_events(start_time);
CREATE INDEX IF NOT EXISTS idx_ln_events_venue ON ln_events(venue_id);
CREATE INDEX IF NOT EXISTS idx_ln_events_title ON ln_events(title_normalized);

-- Event-Entity relationships (performers, sponsors, organizers)
CREATE TABLE IF NOT EXISTS ln_event_entities (
  event_id     BIGINT NOT NULL REFERENCES ln_events(id) ON DELETE CASCADE,
  entity_id    BIGINT NOT NULL REFERENCES ln_entities(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'performer', -- performer, sponsor, organizer, host
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, entity_id, role)
);

-- 055_feeds_clean_slate.sql
-- Drop the old feeds.social multi-column reader tables and create
-- the new "search-to-feed" schema.  feed_oauth_state / feed_oauth_sessions
-- are kept because the OAuth machinery still needs them.

-- ── 1. Drop legacy tables ─────────────────────────────────────────────────────
DROP TABLE IF EXISTS feed_columns CASCADE;
DROP TABLE IF EXISTS feed_users   CASCADE;

-- ── 2. New tables ─────────────────────────────────────────────────────────────

-- Users that sign-in via Bluesky OAuth (re-using the same OAuth flow)
CREATE TABLE IF NOT EXISTS feed_users (
  id           BIGSERIAL PRIMARY KEY,
  did          TEXT NOT NULL UNIQUE,
  handle       TEXT NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Each custom feed created by a user from a search query
CREATE TABLE IF NOT EXISTS custom_feeds (
  id           BIGSERIAL PRIMARY KEY,
  owner_id     BIGINT REFERENCES feed_users(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  query        TEXT NOT NULL,          -- the raw search string
  description  TEXT,
  uuid         TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  bsky_uri     TEXT,                   -- at:// URI after publishing
  seed_uris    JSONB NOT NULL DEFAULT '[]'::jsonb,   -- initial AT-URIs from search
  is_public    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS custom_feeds_owner_idx ON custom_feeds(owner_id);
CREATE INDEX IF NOT EXISTS custom_feeds_uuid_idx  ON custom_feeds(uuid);

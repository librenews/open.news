-- 072_channel_tables.sql
-- Schema for the algorithmic video news channel.

-- Active news stories
CREATE TABLE IF NOT EXISTS channel_stories (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  keywords      TEXT[],
  importance    REAL NOT NULL DEFAULT 0.5,
  category      TEXT,
  article_count INTEGER DEFAULT 0,
  video_count   INTEGER DEFAULT 0,
  source        TEXT,
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_updated  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_channel_stories_importance ON channel_stories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_channel_stories_category ON channel_stories(category);
CREATE INDEX IF NOT EXISTS idx_channel_stories_expires ON channel_stories(expires_at);

-- Video-to-story assignments
CREATE TABLE IF NOT EXISTS video_story_matches (
  media_id      INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  story_id      TEXT NOT NULL REFERENCES channel_stories(id) ON DELETE CASCADE,
  confidence    REAL NOT NULL,
  match_method  TEXT,
  matched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (media_id, story_id)
);

CREATE INDEX IF NOT EXISTS idx_video_story_matches_story ON video_story_matches(story_id);
CREATE INDEX IF NOT EXISTS idx_video_story_matches_confidence ON video_story_matches(confidence DESC);

-- Channel definitions
CREATE TABLE IF NOT EXISTS channels (
  slug          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  category_filter TEXT[],
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Channel lineup history
CREATE TABLE IF NOT EXISTS channel_lineups (
  id            SERIAL PRIMARY KEY,
  channel_slug  TEXT NOT NULL REFERENCES channels(slug),
  segments      JSONB NOT NULL,
  total_duration_ms INTEGER,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_channel_lineups_slug ON channel_lineups(channel_slug, generated_at DESC);

-- Seed channels
INSERT INTO channels (slug, name, description, category_filter) VALUES
  ('all',      'All News',           'Top stories across all topics',             NULL),
  ('politics', 'Politics',           'Government, elections, legislation',        '{politics}'),
  ('tech',     'Tech & AI',          'Technology and artificial intelligence',    '{tech}'),
  ('finance',  'Finance & Business', 'Markets, economics, business',             '{finance}')
ON CONFLICT (slug) DO NOTHING;

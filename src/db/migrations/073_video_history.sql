-- Migration 073: Video History Tracking
-- Tracks news qualifications and playlist position lifecycle

-- 1. News Qualification History
-- Records when a video matches a story above confidence threshold
CREATE TABLE IF NOT EXISTS video_news_history (
  id               BIGSERIAL PRIMARY KEY,
  media_id         INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  media_uri        TEXT NOT NULL,
  story_id         TEXT NOT NULL,
  story_label      TEXT NOT NULL,
  story_category   TEXT,
  story_importance  REAL,
  match_confidence  REAL,
  composite_score   REAL,
  qualified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (media_id, story_id)
);

CREATE INDEX IF NOT EXISTS idx_vnh_media ON video_news_history (media_id);
CREATE INDEX IF NOT EXISTS idx_vnh_story ON video_news_history (story_id);
CREATE INDEX IF NOT EXISTS idx_vnh_qualified ON video_news_history (qualified_at DESC);

-- 2. Playlist Position History
-- Tracks each video's lifecycle on a channel's playlist
CREATE TABLE IF NOT EXISTS video_playlist_history (
  id                BIGSERIAL PRIMARY KEY,
  media_id          INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  media_uri         TEXT NOT NULL,
  channel_slug      TEXT NOT NULL,
  -- Position tracking (1 = top of playlist, video-only numbering)
  peak_position     INTEGER NOT NULL,
  peak_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_position  INTEGER,
  -- Lifecycle
  first_appeared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_appeared_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  bumped_at         TIMESTAMPTZ,
  -- Re-entry
  appearance_count  INTEGER NOT NULL DEFAULT 1,
  return_count      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (media_id, channel_slug)
);

CREATE INDEX IF NOT EXISTS idx_vph_channel ON video_playlist_history (channel_slug);
CREATE INDEX IF NOT EXISTS idx_vph_peak ON video_playlist_history (peak_position);
CREATE INDEX IF NOT EXISTS idx_vph_bumped ON video_playlist_history (bumped_at DESC) WHERE bumped_at IS NOT NULL;

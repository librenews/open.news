-- Track feature tables
-- Uses existing users table (Bluesky OAuth login)

CREATE TABLE tracks (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  keywords    TEXT[] NOT NULL DEFAULT '{}',
  query       TEXT,
  threshold   FLOAT NOT NULL DEFAULT 0.0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  notify_via  TEXT NOT NULL DEFAULT 'feed',
  os_query_id TEXT,
  feed_token  UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tracks_user ON tracks(user_id);
CREATE UNIQUE INDEX idx_tracks_feed_token ON tracks(feed_token);

CREATE TABLE track_matches (
  id          BIGSERIAL PRIMARY KEY,
  track_id    BIGINT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  post_uri    TEXT NOT NULL,
  post_did    TEXT NOT NULL,
  post_text   TEXT NOT NULL,
  matched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(track_id, post_uri)
);
CREATE INDEX idx_track_matches_track ON track_matches(track_id, matched_at DESC);

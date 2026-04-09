-- 015_feed_social.sql

CREATE TABLE IF NOT EXISTS feed_users (
  id BIGSERIAL PRIMARY KEY,
  did TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feed_columns (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES feed_users(id) ON DELETE CASCADE,
  feed_type TEXT NOT NULL, -- 'following' or 'custom'
  feed_uri TEXT,
  title TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for ordering columns per user
CREATE INDEX IF NOT EXISTS feed_columns_user_id_position_idx ON feed_columns(user_id, position);

CREATE TABLE IF NOT EXISTS feed_oauth_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS feed_oauth_sessions (
  sub TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

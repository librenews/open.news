-- Track users: separate from open.news users
CREATE TABLE track_users (
  id           BIGSERIAL PRIMARY KEY,
  did          TEXT NOT NULL UNIQUE,
  handle       TEXT NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OAuth state/sessions for Track (separate from open.news)
CREATE TABLE track_oauth_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE track_oauth_sessions (
  sub        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Update tracks FK to reference track_users
ALTER TABLE tracks DROP CONSTRAINT tracks_user_id_fkey;
ALTER TABLE tracks ADD CONSTRAINT tracks_user_id_fkey FOREIGN KEY (user_id) REFERENCES track_users(id) ON DELETE CASCADE;

-- OAuth state and session storage for blogs.social
CREATE TABLE IF NOT EXISTS blogs_oauth_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS blogs_oauth_sessions (
  sub TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blogs_users (
  did TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  email TEXT,
  email_confirmed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

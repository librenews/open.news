-- 066_snip_oauth.sql
-- Database tables for snip.social ATProto OAuth flow.

CREATE TABLE IF NOT EXISTS snip_oauth_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS snip_oauth_sessions (
  sub TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS snip_users (
  id SERIAL PRIMARY KEY,
  did TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

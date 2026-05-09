-- Centipedia OAuth & session tables (mirrors longform tables)
CREATE TABLE IF NOT EXISTS centipedia_oauth_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS centipedia_oauth_sessions (
  sub TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS centipedia_users (
  did TEXT PRIMARY KEY,
  handle TEXT,
  display_name TEXT,
  avatar_url TEXT,
  email TEXT,
  email_confirmed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS centipedia_drafts (
  id SERIAL PRIMARY KEY,
  document_name TEXT UNIQUE NOT NULL,
  owner_did TEXT NOT NULL,
  title TEXT DEFAULT 'Untitled',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS centipedia_yjs_acl (
  id SERIAL PRIMARY KEY,
  document_name TEXT NOT NULL,
  did TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'read',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(document_name, did)
);

CREATE TABLE IF NOT EXISTS centipedia_yjs_documents (
  name TEXT PRIMARY KEY,
  data BYTEA,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

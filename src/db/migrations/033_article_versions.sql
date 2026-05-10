-- Article version history — track every synthesis/edit of an article
CREATE TABLE IF NOT EXISTS centipedia_article_versions (
  id SERIAL PRIMARY KEY,
  rkey TEXT NOT NULL,                  -- article rkey
  version INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  content_hash TEXT NOT NULL,          -- hash of the full content for dedup
  word_count INTEGER DEFAULT 0,
  citations_used INTEGER DEFAULT 0,    -- number of citations used in this version
  summary TEXT,                        -- short summary of changes
  generated_by TEXT DEFAULT 'agent',   -- 'agent', 'user:did:xxx', etc
  content_snapshot JSONB,              -- full blocks array for this version
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(rkey, version)
);

CREATE INDEX IF NOT EXISTS idx_article_versions_rkey ON centipedia_article_versions(rkey);

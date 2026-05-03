CREATE TABLE IF NOT EXISTS longform_drafts (
  document_name VARCHAR(255) PRIMARY KEY,
  owner_did     TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT 'Untitled',
  published_uri TEXT,
  created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_drafts_owner ON longform_drafts(owner_did);

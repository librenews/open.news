-- Citations submitted by users for agent processing
CREATE TABLE IF NOT EXISTS centipedia_citations (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT,
  excerpt TEXT,
  submitted_by TEXT,  -- DID of submitter (null for anonymous)
  topic TEXT,         -- optional topic suggestion
  article_uri TEXT,   -- AT-URI of target article (null = general)
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, processing, accepted, rejected
  agent_notes TEXT,   -- notes from processing agent
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_centipedia_citations_status ON centipedia_citations(status);
CREATE INDEX IF NOT EXISTS idx_centipedia_citations_topic ON centipedia_citations(topic);

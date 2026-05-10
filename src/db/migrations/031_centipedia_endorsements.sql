-- Endorsement tables — local-first, will promote to PDS lexicon records later
-- Three types: citation endorsements, submitter endorsements, domain endorsements

-- Endorse a specific citation ("this source is credible")
CREATE TABLE IF NOT EXISTS centipedia_endorsement_citations (
  id SERIAL PRIMARY KEY,
  did TEXT NOT NULL,              -- endorser DID
  citation_id INTEGER NOT NULL REFERENCES centipedia_citations(id) ON DELETE CASCADE,
  topic TEXT,                     -- optional topic scope
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(did, citation_id)       -- one endorsement per user per citation
);

-- Endorse a submitter ("I trust this person's judgment")
CREATE TABLE IF NOT EXISTS centipedia_endorsement_submitters (
  id SERIAL PRIMARY KEY,
  did TEXT NOT NULL,              -- endorser DID
  subject TEXT NOT NULL,          -- endorsed submitter DID
  topic TEXT,                     -- optional topic scope
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(did, subject, topic)    -- one endorsement per user per subject per topic
);

-- Endorse a domain/source ("I trust this domain as a source")
CREATE TABLE IF NOT EXISTS centipedia_endorsement_sources (
  id SERIAL PRIMARY KEY,
  did TEXT NOT NULL,              -- endorser DID
  domain TEXT NOT NULL,           -- e.g. "nature.com", "arxiv.org"
  topic TEXT,                     -- optional topic scope
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(did, domain, topic)     -- one endorsement per user per domain per topic
);

-- Indexes for querying endorsement counts and per-user lookups
CREATE INDEX IF NOT EXISTS idx_endorse_citation_cid ON centipedia_endorsement_citations(citation_id);
CREATE INDEX IF NOT EXISTS idx_endorse_citation_did ON centipedia_endorsement_citations(did);
CREATE INDEX IF NOT EXISTS idx_endorse_submitter_subject ON centipedia_endorsement_submitters(subject);
CREATE INDEX IF NOT EXISTS idx_endorse_submitter_did ON centipedia_endorsement_submitters(did);
CREATE INDEX IF NOT EXISTS idx_endorse_source_domain ON centipedia_endorsement_sources(domain);
CREATE INDEX IF NOT EXISTS idx_endorse_source_did ON centipedia_endorsement_sources(did);

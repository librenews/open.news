-- Community submissions: forwarded emails for admin review
CREATE TABLE IF NOT EXISTS ln_submissions (
  id              BIGSERIAL PRIMARY KEY,
  submitted_by    TEXT,                           -- email of the person who forwarded
  original_sender TEXT,                           -- detected original newsletter sender
  original_subject TEXT,
  raw_body        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending, approved, dismissed
  admin_notes     TEXT,
  source_id       BIGINT REFERENCES ln_sources(id), -- linked source if approved
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ln_submissions_status ON ln_submissions(status, created_at DESC);

-- RSS feed tokens for authenticated feeds (following)
CREATE TABLE IF NOT EXISTS rss_feed_tokens (
  token TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rss_feed_tokens_did ON rss_feed_tokens(did);

-- RSS feed tokens for authenticated feeds (following)
CREATE TABLE IF NOT EXISTS rss_feed_tokens (
  token TEXT PRIMARY KEY,
  did TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rss_feed_tokens_did ON rss_feed_tokens(did);

-- Dynamic domain blocklist for content moderation
CREATE TABLE IF NOT EXISTS moderation_blocklist (
  domain TEXT PRIMARY KEY,
  active BOOLEAN DEFAULT true,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feed_requests (
  id BIGSERIAL PRIMARY KEY,
  feed_name TEXT NOT NULL,
  requester_did TEXT,
  cursor_used TEXT,
  limit_requested INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feed_requests_feed_time ON feed_requests(feed_name, created_at DESC);

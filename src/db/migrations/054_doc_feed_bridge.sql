-- Maps verified site.standard.document records to their corresponding
-- app.bsky.feed.post URIs for inclusion in custom feed skeletons.
-- Source is 'organic' (author/reader shared) or 'bot' (Longform bot created).

CREATE TABLE IF NOT EXISTS doc_feed_bridge (
  doc_uri       TEXT PRIMARY KEY,
  post_uri      TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'organic',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dfb_post ON doc_feed_bridge(post_uri);
CREATE INDEX IF NOT EXISTS idx_dfb_created ON doc_feed_bridge(created_at DESC);

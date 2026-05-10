-- Track likes and reposts on site.standard.document records
-- Fed by both local API actions and Jetstream firehose events
CREATE TABLE IF NOT EXISTS article_interactions (
  id SERIAL PRIMARY KEY,
  article_uri TEXT NOT NULL,        -- at://did/site.standard.document/rkey
  actor_did TEXT NOT NULL,          -- who liked/reposted
  interaction_type TEXT NOT NULL,   -- 'like' or 'repost'
  record_uri TEXT,                  -- at://actor/app.bsky.feed.like/rkey (for deletion tracking)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(article_uri, actor_did, interaction_type)
);

CREATE INDEX IF NOT EXISTS idx_article_interactions_article ON article_interactions(article_uri);
CREATE INDEX IF NOT EXISTS idx_article_interactions_record ON article_interactions(record_uri);

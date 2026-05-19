-- Cache of post text for geotagged Bluesky posts
CREATE TABLE IF NOT EXISTS nearby_post_cache (
  post_uri    TEXT PRIMARY KEY,
  post_did    TEXT NOT NULL,
  post_text   TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_nearby_post_cache_did ON nearby_post_cache(post_did);

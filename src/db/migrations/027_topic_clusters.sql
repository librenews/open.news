-- Topic clusters: AI-generated labels for groups of semantically similar tracks
CREATE TABLE IF NOT EXISTS topic_clusters (
  id            BIGSERIAL PRIMARY KEY,
  label         TEXT NOT NULL,
  track_ids     BIGINT[] NOT NULL DEFAULT '{}',
  keywords      TEXT[] NOT NULL DEFAULT '{}',
  centroid      FLOAT8[] DEFAULT NULL,
  article_count INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refreshed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topic_clusters_refreshed ON topic_clusters (refreshed_at DESC);

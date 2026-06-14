-- Author rankings table for the Author Influence Score (AIS) leaderboard
CREATE TABLE IF NOT EXISTS author_rankings (
  author_did       TEXT PRIMARY KEY,
  ais              DOUBLE PRECISION NOT NULL DEFAULT 0,
  engagement_vel   DOUBLE PRECISION NOT NULL DEFAULT 0,
  content_momentum DOUBLE PRECISION NOT NULL DEFAULT 0,
  quality_signal   DOUBLE PRECISION NOT NULL DEFAULT 0,
  consistency      DOUBLE PRECISION NOT NULL DEFAULT 0,
  network_score    DOUBLE PRECISION NOT NULL DEFAULT 0,
  freshness_decay  DOUBLE PRECISION NOT NULL DEFAULT 0,
  rank             INTEGER,
  article_count_90d INTEGER NOT NULL DEFAULT 0,
  total_likes      INTEGER NOT NULL DEFAULT 0,
  total_shares     INTEGER NOT NULL DEFAULT 0,
  follower_count   INTEGER NOT NULL DEFAULT 0,
  last_published   TIMESTAMP WITH TIME ZONE,
  computed_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_author_rankings_ais ON author_rankings (ais DESC);
CREATE INDEX IF NOT EXISTS idx_author_rankings_rank ON author_rankings (rank ASC) WHERE rank IS NOT NULL;

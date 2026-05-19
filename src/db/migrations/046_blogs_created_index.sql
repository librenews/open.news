-- Index for blogs.social feed ordering (created_at DESC)
CREATE INDEX CONCURRENTLY IF NOT EXISTS site_standard_articles_created_idx
  ON site_standard_articles (created_at DESC);

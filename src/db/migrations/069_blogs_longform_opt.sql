-- Index for verified articles ordered by publication date (used by blogs trending feed)
CREATE INDEX IF NOT EXISTS idx_site_standard_articles_trending_opt
  ON site_standard_articles (verified, published_at DESC)
  WHERE suppressed = false;

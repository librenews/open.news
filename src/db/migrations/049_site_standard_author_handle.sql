-- Add author_handle column to site_standard_articles for efficient BridgyFed filtering
ALTER TABLE site_standard_articles
  ADD COLUMN IF NOT EXISTS author_handle TEXT;

CREATE INDEX IF NOT EXISTS site_standard_articles_author_handle
  ON site_standard_articles (author_handle);

-- Partial index specifically for BridgyFed detection
CREATE INDEX IF NOT EXISTS site_standard_articles_bridgyfed
  ON site_standard_articles (author_did)
  WHERE author_handle LIKE '%.web.brid.gy';

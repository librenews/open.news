-- Add verification tracking to articles and publications
ALTER TABLE site_standard_articles ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT NULL;
ALTER TABLE site_standard_articles ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

ALTER TABLE site_publications ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT NULL;
ALTER TABLE site_publications ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- Index for verified lookups
CREATE INDEX IF NOT EXISTS idx_site_standard_articles_verified
  ON site_standard_articles (verified) WHERE verified IS NOT NULL;

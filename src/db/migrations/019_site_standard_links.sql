ALTER TABLE site_standard_articles ADD COLUMN IF NOT EXISTS site TEXT;
ALTER TABLE site_standard_articles ADD COLUMN IF NOT EXISTS path TEXT;
ALTER TABLE site_standard_articles ADD COLUMN IF NOT EXISTS raw_record JSONB;

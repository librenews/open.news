-- Add action column to moderation_blocklist to support two-tier moderation:
-- 'block'    = don't index at all (NSFW, spam, etc.)
-- 'suppress' = index and allow search/follow, but hide from Latest/For You feeds
ALTER TABLE moderation_blocklist ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'block';

-- Create index for fast suppress lookups in feed queries
CREATE INDEX IF NOT EXISTS idx_moderation_blocklist_action ON moderation_blocklist (action) WHERE active = true;

-- Add suppressed flag to articles table (indexed for fast homepage filtering)
ALTER TABLE site_standard_articles ADD COLUMN IF NOT EXISTS suppressed BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_site_standard_articles_suppressed ON site_standard_articles (suppressed) WHERE suppressed = false;

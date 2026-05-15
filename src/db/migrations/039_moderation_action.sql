-- Add action column to moderation_blocklist to support two-tier moderation:
-- 'block'    = don't index at all (NSFW, spam, etc.)
-- 'suppress' = index and allow search/follow, but hide from Latest/For You feeds
ALTER TABLE moderation_blocklist ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'block';

-- Create index for fast suppress lookups in feed queries
CREATE INDEX IF NOT EXISTS idx_moderation_blocklist_action ON moderation_blocklist (action) WHERE active = true;

-- Add suppressed flag to articles table (indexed for fast homepage filtering)
ALTER TABLE site_standard_articles ADD COLUMN IF NOT EXISTS suppressed BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_site_standard_articles_suppressed ON site_standard_articles (suppressed) WHERE suppressed = false;

-- Auto-backfill: when a domain is added/updated in moderation_blocklist,
-- update all matching articles' suppressed flag
CREATE OR REPLACE FUNCTION sync_suppressed_articles() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.action = 'suppress' AND NEW.active = true THEN
    UPDATE site_standard_articles
    SET suppressed = true
    WHERE suppressed = false
      AND (site LIKE '%' || NEW.domain || '%'
           OR raw_record->>'site' LIKE '%' || NEW.domain || '%');
  ELSIF NEW.action != 'suppress' OR NEW.active = false THEN
    UPDATE site_standard_articles
    SET suppressed = false
    WHERE suppressed = true
      AND (site LIKE '%' || NEW.domain || '%'
           OR raw_record->>'site' LIKE '%' || NEW.domain || '%');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_suppressed ON moderation_blocklist;
CREATE TRIGGER trg_sync_suppressed
  AFTER INSERT OR UPDATE ON moderation_blocklist
  FOR EACH ROW EXECUTE FUNCTION sync_suppressed_articles();

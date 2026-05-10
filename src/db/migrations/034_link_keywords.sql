-- Add link_keywords column to article versions
-- Stores keyword-to-citation mapping for inline external source links
ALTER TABLE centipedia_article_versions
  ADD COLUMN IF NOT EXISTS link_keywords JSONB DEFAULT '[]';

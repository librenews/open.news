-- 071_media_categories.sql
-- Add LLM-derived topic categories to media transcripts.

ALTER TABLE media_transcripts
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS category_confidence REAL,
  ADD COLUMN IF NOT EXISTS secondary_category TEXT;

CREATE INDEX IF NOT EXISTS idx_media_transcripts_category
  ON media_transcripts(category);

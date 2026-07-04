-- 065_media_thumbnail.sql
-- Add thumbnail_cid column to store video cover frame images from the firehose.
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS thumbnail_cid TEXT;

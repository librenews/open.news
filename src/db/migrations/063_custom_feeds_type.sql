-- 063_custom_feeds_type.sql
-- Add feed_type column to custom_feeds to distinguish standard text feeds from custom video search feeds.

ALTER TABLE custom_feeds ADD COLUMN IF NOT EXISTS feed_type TEXT NOT NULL DEFAULT 'text';

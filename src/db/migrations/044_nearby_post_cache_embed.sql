-- Add embed JSONB column to nearby_post_cache for link card data
ALTER TABLE nearby_post_cache ADD COLUMN IF NOT EXISTS embed jsonb DEFAULT NULL;

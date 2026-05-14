-- Fix: add UNIQUE constraint on did for ON CONFLICT support
-- Safe to run even if already unique
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rss_feed_tokens_did_key'
  ) THEN
    ALTER TABLE rss_feed_tokens ADD CONSTRAINT rss_feed_tokens_did_key UNIQUE (did);
  END IF;
END $$;

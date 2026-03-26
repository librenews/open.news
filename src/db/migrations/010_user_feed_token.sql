-- Add feed_token to track_users for all-matches RSS feed (privacy-safe UUID)
ALTER TABLE track_users ADD COLUMN feed_token UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX idx_track_users_feed_token ON track_users(feed_token);

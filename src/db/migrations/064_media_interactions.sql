-- 064_media_interactions.sql
-- Create table to track likes and reposts specifically for video posts.

CREATE TABLE IF NOT EXISTS media_interactions (
  id               SERIAL PRIMARY KEY,
  media_uri        TEXT NOT NULL,               -- subject uri of the post containing the video (e.g. at://...)
  actor_did        TEXT NOT NULL,               -- did of user liking/reposting
  interaction_type TEXT NOT NULL,               -- 'like' or 'repost'
  record_uri       TEXT NOT NULL UNIQUE,        -- uri of the like/repost record itself (for deletion)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_interactions_composite ON media_interactions(media_uri, actor_did, interaction_type);
CREATE INDEX IF NOT EXISTS idx_media_interactions_media_uri ON media_interactions(media_uri);

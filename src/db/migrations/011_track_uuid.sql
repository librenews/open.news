-- Add public UUID for track UI routes (separate from feed_token to protect RSS URLs)
ALTER TABLE tracks ADD COLUMN uuid UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX idx_tracks_uuid ON tracks(uuid);

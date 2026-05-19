-- Local mirror of site.standard.graph.subscription records created on user PDSes
-- rkey is stored so we can delete the PDS record on unfollow
CREATE TABLE IF NOT EXISTS blogs_follows (
  id          BIGSERIAL PRIMARY KEY,
  follower_did TEXT NOT NULL,
  following_did TEXT NOT NULL,
  rkey        TEXT NOT NULL,          -- AT Protocol rkey for the subscription record
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (follower_did, following_did)
);

CREATE INDEX IF NOT EXISTS blogs_follows_follower ON blogs_follows (follower_did);
CREATE INDEX IF NOT EXISTS blogs_follows_following ON blogs_follows (following_did);

-- 11_rss_cloud.sql
-- Subscriptions for RSS Cloud real-time updates (http-post protocol)

CREATE TABLE IF NOT EXISTS rss_cloud_subs (
  id           BIGSERIAL PRIMARY KEY,
  feed_url     TEXT NOT NULL,
  domain       TEXT NOT NULL,
  port         INTEGER NOT NULL,
  path         TEXT NOT NULL,
  protocol     TEXT NOT NULL DEFAULT 'http-post',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (feed_url, domain, port, path)
);

CREATE INDEX IF NOT EXISTS rss_cloud_subs_feed_url_idx ON rss_cloud_subs(feed_url);

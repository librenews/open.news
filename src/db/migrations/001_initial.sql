-- schema_migrations: tracks applied migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- users: authenticated Bluesky accounts
CREATE TABLE users (
  id                BIGSERIAL PRIMARY KEY,
  did               TEXT NOT NULL UNIQUE,
  handle            TEXT NOT NULL,
  display_name      TEXT,
  avatar_url        TEXT,
  access_jwt        TEXT,
  refresh_jwt       TEXT,
  token_expires_at  TIMESTAMPTZ,
  follows_synced_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- sources: accounts or feeds being monitored
CREATE TABLE sources (
  id            BIGSERIAL PRIMARY KEY,
  type          TEXT NOT NULL DEFAULT 'bluesky',
  did           TEXT,
  handle        TEXT,
  display_name  TEXT,
  avatar_url    TEXT,
  feed_url      TEXT,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (type, did),
  UNIQUE (type, feed_url)
);

-- user_sources: which users follow which sources
CREATE TABLE user_sources (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id   BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, source_id)
);

-- articles: one row per unique URL
CREATE TABLE articles (
  id                  BIGSERIAL PRIMARY KEY,
  url                 TEXT NOT NULL UNIQUE,
  canonical_url       TEXT,
  title               TEXT,
  description         TEXT,
  image_url           TEXT,
  author              TEXT,
  published_at        TIMESTAMPTZ,
  site_name           TEXT,
  og_type             TEXT,
  jsonld_type         TEXT,
  news_score          INTEGER NOT NULL DEFAULT 0,
  is_news             BOOLEAN NOT NULL DEFAULT FALSE,
  fetch_status        TEXT NOT NULL DEFAULT 'pending',
  fetch_error         TEXT,
  fetched_at          TIMESTAMPTZ,
  full_text           TEXT,
  text_extracted_at   TIMESTAMPTZ,
  word_count          INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX articles_fetch_status_idx ON articles(fetch_status);
CREATE INDEX articles_is_news_idx ON articles(is_news);
CREATE INDEX articles_published_at_idx ON articles(published_at DESC);

-- article_sources: which source(s) shared an article
CREATE TABLE article_sources (
  article_id    BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  source_id     BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  post_uri      TEXT,
  post_cid      TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (article_id, source_id)
);

-- user_articles: each user's relationship to articles
CREATE TABLE user_articles (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id  BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  seen_at     TIMESTAMPTZ,
  saved_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, article_id)
);

CREATE INDEX user_articles_user_id_created_idx ON user_articles(user_id, created_at DESC);

-- bot_interactions: log of mentions/DMs the bot has processed
CREATE TABLE bot_interactions (
  id               BIGSERIAL PRIMARY KEY,
  post_uri         TEXT,
  sender_did       TEXT NOT NULL,
  user_id          BIGINT REFERENCES users(id),
  interaction_type TEXT NOT NULL,
  input_text       TEXT,
  response_text    TEXT,
  llm_provider     TEXT,
  articles_used    BIGINT[],
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- jetstream_cursor: persists resume position for firehose reconnection
CREATE TABLE jetstream_cursor (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cursor     BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO jetstream_cursor (cursor) VALUES (NULL);

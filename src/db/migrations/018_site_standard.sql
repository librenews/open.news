CREATE TABLE IF NOT EXISTS known_site_standard_dids (
  did TEXT PRIMARY KEY,
  discovered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_standard_articles (
  uri TEXT PRIMARY KEY,
  author_did TEXT NOT NULL,
  title TEXT,
  description TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS site_standard_articles_author_idx ON site_standard_articles (author_did);
CREATE INDEX IF NOT EXISTS site_standard_articles_published_idx ON site_standard_articles (published_at DESC);

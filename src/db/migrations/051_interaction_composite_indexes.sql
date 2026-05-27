-- Composite indexes for article_interactions to speed up
-- the LATERAL JOIN subqueries in blogs/longform feed pages.
-- The existing index only covers article_uri alone.

CREATE INDEX IF NOT EXISTS idx_article_interactions_uri_type
  ON article_interactions(article_uri, interaction_type);

CREATE INDEX IF NOT EXISTS idx_article_interactions_uri_actor_type
  ON article_interactions(article_uri, actor_did, interaction_type);

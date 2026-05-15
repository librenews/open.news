-- Likes on open.news convergence/latest articles (URL-based news)
CREATE TABLE IF NOT EXISTS news_likes (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(article_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_news_likes_article ON news_likes(article_id);
CREATE INDEX IF NOT EXISTS idx_news_likes_user ON news_likes(user_id);

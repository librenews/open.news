-- Many-to-many relationship between citations and articles
-- A citation can feed into multiple articles, and an article uses multiple citations
CREATE TABLE IF NOT EXISTS centipedia_article_citations (
  id SERIAL PRIMARY KEY,
  citation_id INTEGER NOT NULL REFERENCES centipedia_citations(id) ON DELETE CASCADE,
  article_rkey TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(citation_id, article_rkey)
);

CREATE INDEX IF NOT EXISTS idx_article_citations_rkey ON centipedia_article_citations(article_rkey);
CREATE INDEX IF NOT EXISTS idx_article_citations_citation ON centipedia_article_citations(citation_id);

-- Migrate existing article_rkey data from citations table
INSERT INTO centipedia_article_citations (citation_id, article_rkey, created_at)
SELECT id, article_rkey, COALESCE(processed_at, created_at)
FROM centipedia_citations
WHERE article_rkey IS NOT NULL
ON CONFLICT (citation_id, article_rkey) DO NOTHING;

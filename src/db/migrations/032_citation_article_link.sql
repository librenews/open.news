-- Link citations to articles via article_rkey
-- When agents assign citations to an article, this field gets populated

ALTER TABLE centipedia_citations ADD COLUMN IF NOT EXISTS article_rkey TEXT;
ALTER TABLE centipedia_citations ADD COLUMN IF NOT EXISTS excerpt TEXT;

CREATE INDEX IF NOT EXISTS idx_citations_article_rkey ON centipedia_citations(article_rkey);

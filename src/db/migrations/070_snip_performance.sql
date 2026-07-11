-- 070_snip_performance.sql
-- Performance improvements for the snip video service.

-- 1. Index on media_transcripts.created_at for trending terms query
CREATE INDEX IF NOT EXISTS idx_media_transcripts_created_at
  ON media_transcripts(created_at);

-- 2. Index on media_transcripts.language for English-only filtering
CREATE INDEX IF NOT EXISTS idx_media_transcripts_language
  ON media_transcripts(language);

-- 3. Materialized view for interaction counts
--    Replaces expensive inline subquery aggregations of media_interactions
--    that were running on every page load (6 queries).
--    Refresh concurrently every ~5 minutes from the snip service.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_media_interaction_counts AS
SELECT
  media_uri,
  COUNT(*) FILTER (WHERE interaction_type = 'like') as like_count,
  COUNT(*) FILTER (WHERE interaction_type = 'repost') as repost_count
FROM media_interactions
GROUP BY media_uri;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_interaction_counts_uri
  ON mv_media_interaction_counts(media_uri);

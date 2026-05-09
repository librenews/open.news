import { db } from '../client.js';

export interface ConvergenceArticle {
  id: number;
  title: string;
  url: string;
  description: string | null;
  image_url: string | null;
  site_name: string | null;
  published_at: string | null;
  convergence_score: number;
  share_count: number;
  track_names: string[];
}

/**
 * Fetch articles ranked by convergence score — how many distinct tracks
 * independently surfaced posts linking to the same article.
 * Falls back to share_count and recency for articles with low convergence.
 */
export async function getConvergenceArticles(
  hours: number = 48,
  limit: number = 30
): Promise<ConvergenceArticle[]> {
  const { rows } = await db.query(
    `SELECT 
       a.id, a.title, a.url, a.description, a.image_url, a.site_name,
       a.published_at,
       COUNT(DISTINCT tm.track_id) AS convergence_score,
       COUNT(DISTINCT asrc.source_id) AS share_count,
       ARRAY_AGG(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL) AS track_names
     FROM articles a
     JOIN article_sources asrc ON a.id = asrc.article_id
     LEFT JOIN track_matches tm ON asrc.post_uri = tm.post_uri
     LEFT JOIN tracks t ON tm.track_id = t.id
     WHERE a.is_news = true
       AND a.word_count > 50
       AND a.published_at > NOW() - INTERVAL '1 hour' * $1
       AND a.url NOT LIKE '%bsky.app%'
       AND a.url NOT LIKE '%ranked.news%'
     GROUP BY a.id
     ORDER BY
       (COUNT(DISTINCT tm.track_id) + COUNT(DISTINCT asrc.source_id) * 0.5)
       / POWER(GREATEST(EXTRACT(EPOCH FROM (NOW() - COALESCE(a.published_at, a.created_at))) / 3600, 0) + 2, 1.5) DESC,
       CASE WHEN a.published_at > NOW() THEN a.created_at ELSE a.published_at END DESC NULLS LAST
     LIMIT $2`,
    [hours, limit]
  );

  return rows.map((r: any) => ({
    id: Number(r.id),
    title: r.title,
    url: r.url,
    description: r.description,
    image_url: r.image_url,
    site_name: r.site_name,
    published_at: r.published_at?.toISOString() ?? null,
    convergence_score: Number(r.convergence_score),
    share_count: Number(r.share_count),
    track_names: r.track_names || [],
  }));
}

/**
 * Fetch recent articles ordered by publication date — the "Latest" view.
 */
export async function getRecentArticles(
  hours: number = 24,
  limit: number = 30
): Promise<ConvergenceArticle[]> {
  const { rows } = await db.query(
    `SELECT 
       a.id, a.title, a.url, a.description, a.image_url, a.site_name,
       a.published_at,
       0 AS convergence_score,
       COUNT(DISTINCT asrc.source_id) AS share_count,
       ARRAY[]::text[] AS track_names
     FROM articles a
     LEFT JOIN article_sources asrc ON a.id = asrc.article_id
     WHERE a.is_news = true
       AND a.word_count > 50
       AND a.published_at > NOW() - INTERVAL '1 hour' * $1
       AND a.url NOT LIKE '%bsky.app%'
       AND a.url NOT LIKE '%ranked.news%'
     GROUP BY a.id
     ORDER BY CASE WHEN a.published_at > NOW() THEN a.created_at ELSE a.published_at END DESC NULLS LAST
     LIMIT $2`,
    [hours, limit]
  );

  return rows.map((r: any) => ({
    id: Number(r.id),
    title: r.title,
    url: r.url,
    description: r.description,
    image_url: r.image_url,
    site_name: r.site_name,
    published_at: r.published_at?.toISOString() ?? null,
    convergence_score: Number(r.convergence_score),
    share_count: Number(r.share_count),
    track_names: r.track_names || [],
  }));
}

/**
 * Get aggregate stats for the front page header.
 */
export async function getConvergenceStats(): Promise<{
  totalTracks: number;
  articlesToday: number;
  activeTopics: number;
}> {
  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM tracks WHERE is_active = true) AS total_tracks,
      (SELECT COUNT(*) FROM articles WHERE is_news = true AND published_at > NOW() - INTERVAL '24 hours') AS articles_today,
      (SELECT COUNT(*) FROM topic_clusters WHERE article_count > 0) AS active_topics
  `);

  return {
    totalTracks: Number(rows[0].total_tracks),
    articlesToday: Number(rows[0].articles_today),
    activeTopics: Number(rows[0].active_topics),
  };
}

export interface TopicCluster {
  id: number;
  label: string;
  articleCount: number;
  trackCount: number;
}

/**
 * Fetch topic clusters ordered by article count.
 */
export async function getTopicClusters(): Promise<TopicCluster[]> {
  const { rows } = await db.query(
    `SELECT id, label, article_count, array_length(track_ids, 1) AS track_count
     FROM topic_clusters
     WHERE article_count > 0
     ORDER BY article_count DESC`
  );
  return rows.map((r: any) => ({
    id: Number(r.id),
    label: r.label,
    articleCount: Number(r.article_count),
    trackCount: Number(r.track_count || 1),
  }));
}

/**
 * Fetch articles filtered by a topic cluster.
 */
export async function getArticlesByTopic(
  topicId: number,
  limit: number = 30
): Promise<ConvergenceArticle[]> {
  const { rows } = await db.query(
    `SELECT 
       a.id, a.title, a.url, a.description, a.image_url, a.site_name,
       a.published_at,
       COUNT(DISTINCT tm.track_id) AS convergence_score,
       COUNT(DISTINCT asrc.source_id) AS share_count,
       ARRAY[]::text[] AS track_names
     FROM articles a
     JOIN article_sources asrc ON a.id = asrc.article_id
     JOIN track_matches tm ON asrc.post_uri = tm.post_uri
     JOIN topic_clusters tc ON tm.track_id = ANY(tc.track_ids)
     WHERE tc.id = $1
       AND a.is_news = true
       AND a.word_count > 50
       AND a.url NOT LIKE '%bsky.app%'
       AND a.url NOT LIKE '%ranked.news%'
     GROUP BY a.id
     ORDER BY CASE WHEN a.published_at > NOW() THEN a.created_at ELSE a.published_at END DESC NULLS LAST
     LIMIT $2`,
    [topicId, limit]
  );

  return rows.map((r: any) => ({
    id: Number(r.id),
    title: r.title,
    url: r.url,
    description: r.description,
    image_url: r.image_url,
    site_name: r.site_name,
    published_at: r.published_at?.toISOString() ?? null,
    convergence_score: Number(r.convergence_score),
    share_count: Number(r.share_count),
    track_names: r.track_names || [],
  }));
}

/**
 * Given a user's DID, return article IDs where their tracks helped
 * surface the article (i.e., their tracks matched posts linked to the article).
 */
export async function getUserContributedArticleIds(
  userDid: string,
  articleIds: number[]
): Promise<Set<number>> {
  if (articleIds.length === 0) return new Set();

  const { rows } = await db.query<{ article_id: number }>(
    `SELECT DISTINCT a.id AS article_id
     FROM articles a
     JOIN article_sources asrc ON a.id = asrc.article_id
     JOIN track_matches tm ON asrc.post_uri = tm.post_uri
     JOIN tracks t ON tm.track_id = t.id
     JOIN track_users tu ON tu.id = t.user_id
     WHERE tu.did = $1
       AND a.id = ANY($2)`,
    [userDid, articleIds]
  );

  return new Set(rows.map(r => Number(r.article_id)));
}

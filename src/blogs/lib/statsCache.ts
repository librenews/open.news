import { db } from '../../db/client.js';

interface StatsCache {
  data: BlogStats;
  fetchedAt: number;
}

export interface BlogStats {
  // Hero KPIs
  waa: number;                // rolling 7-day unique authors
  daa: number;                // yesterday unique authors
  postsYesterday: number;
  totalAuthors: number;
  totalPosts: number;
  avgPostsPerAuthor: number;  // weekday avg last 14 days

  // 30-day trend (WAA rolling)
  waaTrend: { day: string; waa: number }[];

  // 30-day daily posts + authors
  dailyActivity: { day: string; posts: number; authors: number }[];

  // 14-day retention
  retention: { day: string; retained: number; new_authors: number; churned: number }[];

  // Hourly heatmap last 7 days (day 0-6, hour 0-23)
  hourlyHeatmap: { dow: number; hour: number; posts: number }[];

  // Top 20 sites this week
  topSites: { site: string; posts: number }[];

  // Language distribution
  languages: { language: string; count: number }[];

  // New authors per day (30 days)
  newAuthors: { day: string; new_authors: number }[];

  updatedAt: string;
}

let _cache: StatsCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getBlogStats(): Promise<BlogStats> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.data;
  }

  const [
    kpiRows,
    waaTrendRows,
    dailyRows,
    retentionRows,
    heatmapRows,
    topSiteRows,
    languageRows,
    newAuthorRows,
  ] = await Promise.all([
    // Hero KPIs
    db.query(`
      SELECT
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE created_at >= NOW() - INTERVAL '7 days') AS waa,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE DATE(created_at) = CURRENT_DATE - 1) AS daa,
        (SELECT COUNT(*) FROM site_standard_articles
         WHERE DATE(created_at) = CURRENT_DATE - 1) AS posts_yesterday,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles) AS total_authors,
        (SELECT COUNT(*) FROM site_standard_articles) AS total_posts,
        (SELECT ROUND(AVG(daily_posts)::numeric, 1)
         FROM (
           SELECT DATE(created_at) AS d, COUNT(*) / NULLIF(COUNT(DISTINCT author_did), 0) AS daily_posts
           FROM site_standard_articles
           WHERE created_at >= NOW() - INTERVAL '14 days'
             AND EXTRACT(DOW FROM created_at) BETWEEN 1 AND 5
           GROUP BY DATE(created_at)
         ) sub) AS avg_posts_per_author
    `),

    // WAA 30-day rolling trend
    db.query(`
      SELECT
        DATE(gs.day) AS day,
        COUNT(DISTINCT a.author_did) AS waa
      FROM generate_series(NOW() - INTERVAL '30 days', NOW(), INTERVAL '1 day') AS gs(day)
      JOIN site_standard_articles a
        ON a.created_at >= gs.day - INTERVAL '7 days'
        AND a.created_at < gs.day
      GROUP BY DATE(gs.day)
      ORDER BY DATE(gs.day)
    `),

    // Daily activity 30 days
    db.query(`
      SELECT
        DATE(created_at) AS day,
        COUNT(*) AS posts,
        COUNT(DISTINCT author_did) AS authors
      FROM site_standard_articles
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND created_at < DATE_TRUNC('day', NOW())
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at)
    `),

    // 14-day retention
    db.query(`
      WITH days AS (
        SELECT generate_series(NOW() - INTERVAL '14 days', NOW() - INTERVAL '1 day', INTERVAL '1 day')::date AS d
      ),
      prev AS (
        SELECT d, author_did
        FROM days
        JOIN site_standard_articles ON DATE(created_at) = d - 1
      ),
      curr AS (
        SELECT d, author_did
        FROM days
        JOIN site_standard_articles ON DATE(created_at) = d
      )
      SELECT
        c.d::text AS day,
        COUNT(*) FILTER (WHERE p.author_did IS NOT NULL) AS retained,
        COUNT(*) FILTER (WHERE p.author_did IS NULL) AS new_authors,
        (SELECT COUNT(DISTINCT p2.author_did) FROM prev p2
         LEFT JOIN curr c2 ON c2.d = p2.d AND c2.author_did = p2.author_did
         WHERE c2.author_did IS NULL AND p2.d = c.d) AS churned
      FROM curr c
      LEFT JOIN prev p USING (d, author_did)
      GROUP BY c.d
      ORDER BY c.d
    `),

    // Hourly heatmap last 7 days
    db.query(`
      SELECT
        EXTRACT(DOW FROM created_at)::int AS dow,
        EXTRACT(HOUR FROM created_at)::int AS hour,
        COUNT(*) AS posts
      FROM site_standard_articles
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY dow, hour
      ORDER BY dow, hour
    `),

    // Top 20 sites this week
    db.query(`
      SELECT
        REGEXP_REPLACE(site, '^https?://(www\\.)?', '') AS site,
        COUNT(*) AS posts
      FROM site_standard_articles
      WHERE created_at >= NOW() - INTERVAL '7 days'
        AND site IS NOT NULL AND site != ''
      GROUP BY REGEXP_REPLACE(site, '^https?://(www\\.)?', '')
      ORDER BY posts DESC
      LIMIT 20
    `),

    // Language distribution
    db.query(`
      SELECT
        COALESCE(language, 'unknown') AS language,
        COUNT(*) AS count
      FROM site_standard_articles
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY language
      ORDER BY count DESC
      LIMIT 12
    `),

    // New authors per day 30 days (first-time publishers)
    db.query(`
      SELECT
        DATE(first_seen) AS day,
        COUNT(*) AS new_authors
      FROM (
        SELECT author_did, MIN(created_at) AS first_seen
        FROM site_standard_articles
        GROUP BY author_did
      ) sub
      WHERE first_seen >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(first_seen)
      ORDER BY DATE(first_seen)
    `),
  ]);

  const kpi = kpiRows.rows[0];

  const data: BlogStats = {
    waa: Number(kpi.waa),
    daa: Number(kpi.daa),
    postsYesterday: Number(kpi.posts_yesterday),
    totalAuthors: Number(kpi.total_authors),
    totalPosts: Number(kpi.total_posts),
    avgPostsPerAuthor: Number(kpi.avg_posts_per_author),
    waaTrend: waaTrendRows.rows.map((r: any) => ({ day: r.day.toISOString().slice(0, 10), waa: Number(r.waa) })),
    dailyActivity: dailyRows.rows.map((r: any) => ({ day: r.day.toISOString().slice(0, 10), posts: Number(r.posts), authors: Number(r.authors) })),
    retention: retentionRows.rows.map((r: any) => ({ day: r.day.slice(0, 10), retained: Number(r.retained), new_authors: Number(r.new_authors), churned: Number(r.churned) })),
    hourlyHeatmap: heatmapRows.rows.map((r: any) => ({ dow: Number(r.dow), hour: Number(r.hour), posts: Number(r.posts) })),
    topSites: topSiteRows.rows.map((r: any) => ({ site: r.site, posts: Number(r.posts) })),
    languages: languageRows.rows.map((r: any) => ({ language: r.language, count: Number(r.count) })),
    newAuthors: newAuthorRows.rows.map((r: any) => ({ day: r.day.toISOString().slice(0, 10), new_authors: Number(r.new_authors) })),
    updatedAt: new Date().toISOString(),
  };

  _cache = { data, fetchedAt: Date.now() };
  return data;
}

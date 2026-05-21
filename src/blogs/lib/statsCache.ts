import { db } from '../../db/client.js';

interface StatsCache {
  data: BlogStats;
  fetchedAt: number;
}

export interface BlogStats {
  // Hero KPIs
  waa: number;
  daa: number;
  postsYesterday: number;
  totalAuthors: number;
  totalPosts: number;
  avgPostsPerAuthor: number;

  // BridgyFed split
  waa_native: number;
  waa_bridgyfed: number;
  daa_native: number;
  daa_bridgyfed: number;
  posts_native: number;
  posts_bridgyfed: number;
  totalAuthors_native: number;
  totalAuthors_bridgyfed: number;
  totalPosts_native: number;
  totalPosts_bridgyfed: number;

  // 30-day trend (WAA rolling)
  waaTrend: { day: string; waa: number; waa_native: number; waa_bridgyfed: number }[];

  // 30-day daily posts + authors
  dailyActivity: { day: string; posts: number; authors: number; posts_native: number; posts_bridgyfed: number; authors_native: number; authors_bridgyfed: number }[];

  // 14-day retention (with native/bridgyfed split)
  retention: { day: string; retained: number; new_authors: number; churned: number;
    retained_native: number; new_native: number; churned_native: number;
    retained_bridgyfed: number; new_bridgyfed: number; churned_bridgyfed: number }[];

  // Hourly heatmap last 7 days (day 0-6, hour 0-23)
  hourlyHeatmap: { dow: number; hour: number; posts: number; posts_native: number; posts_bridgyfed: number }[];

  // Top 20 sites this week (all, native-only, bridgyfed-only)
  topSites: { site: string; posts: number }[];
  topSitesNative: { site: string; posts: number }[];
  topSitesBridgyfed: { site: string; posts: number }[];

  // Language distribution (all, native-only, bridgyfed-only)
  languages: { language: string; count: number }[];
  languagesNative: { language: string; count: number }[];
  languagesBridgyfed: { language: string; count: number }[];

  // New authors per day (30 days)
  newAuthors: { day: string; new_authors: number; new_native: number; new_bridgyfed: number }[];

  updatedAt: string;
}

let _cache: StatsCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Force-refresh the stats cache (ignores TTL). Called at startup and by the background timer. */
export async function warmStatsCache(): Promise<void> {
  const data = await _fetchStats();
  _cache = { data, fetchedAt: Date.now() };
}

async function _fetchStats(): Promise<BlogStats> {
  const [
    kpiRows,
    waaTrendRows,
    dailyRows,
    retentionRows,
    heatmapRows,
    topSiteRows,
    topSiteNativeRows,
    topSiteBridgyfedRows,
    languageRows,
    languageNativeRows,
    languageBridgyfedRows,
    newAuthorRows,
  ] = await Promise.all([
    // Hero KPIs
    db.query(`
      SELECT
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE created_at >= NOW() - INTERVAL '7 days') AS waa,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE created_at >= NOW() - INTERVAL '7 days'
           AND (author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy')) AS waa_native,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE created_at >= NOW() - INTERVAL '7 days'
           AND author_handle LIKE '%.web.brid.gy') AS waa_bridgyfed,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE DATE(created_at) = CURRENT_DATE - 1) AS daa,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE DATE(created_at) = CURRENT_DATE - 1
           AND (author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy')) AS daa_native,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE DATE(created_at) = CURRENT_DATE - 1
           AND author_handle LIKE '%.web.brid.gy') AS daa_bridgyfed,
        (SELECT COUNT(*) FROM site_standard_articles
         WHERE DATE(created_at) = CURRENT_DATE - 1) AS posts_yesterday,
        (SELECT COUNT(*) FROM site_standard_articles
         WHERE DATE(created_at) = CURRENT_DATE - 1
           AND (author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy')) AS posts_native,
        (SELECT COUNT(*) FROM site_standard_articles
         WHERE DATE(created_at) = CURRENT_DATE - 1
           AND author_handle LIKE '%.web.brid.gy') AS posts_bridgyfed,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles) AS total_authors,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE (author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy')) AS total_authors_native,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE author_handle LIKE '%.web.brid.gy') AS total_authors_bridgyfed,
        (SELECT COUNT(*) FROM site_standard_articles) AS total_posts,
        (SELECT COUNT(*) FROM site_standard_articles
         WHERE (author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy')) AS total_posts_native,
        (SELECT COUNT(*) FROM site_standard_articles
         WHERE author_handle LIKE '%.web.brid.gy') AS total_posts_bridgyfed,
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
        COUNT(DISTINCT a.author_did) AS waa,
        COUNT(DISTINCT a.author_did) FILTER (WHERE a.author_handle IS NULL OR a.author_handle NOT LIKE '%.web.brid.gy') AS waa_native,
        COUNT(DISTINCT a.author_did) FILTER (WHERE a.author_handle LIKE '%.web.brid.gy') AS waa_bridgyfed
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
        COUNT(DISTINCT author_did) AS authors,
        COUNT(*) FILTER (WHERE author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy') AS posts_native,
        COUNT(*) FILTER (WHERE author_handle LIKE '%.web.brid.gy') AS posts_bridgyfed,
        COUNT(DISTINCT author_did) FILTER (WHERE author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy') AS authors_native,
        COUNT(DISTINCT author_did) FILTER (WHERE author_handle LIKE '%.web.brid.gy') AS authors_bridgyfed
      FROM site_standard_articles
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND created_at < DATE_TRUNC('day', NOW())
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at)
    `),

    // 14-day retention with native/bridgyfed split
    db.query(`
      WITH days AS (
        SELECT generate_series(NOW() - INTERVAL '14 days', NOW() - INTERVAL '1 day', INTERVAL '1 day')::date AS d
      ),
      prev AS (
        SELECT DISTINCT d, a.author_did, a.author_handle AS handle
        FROM days
        JOIN site_standard_articles a ON DATE(a.created_at) = d - 1
      ),
      curr AS (
        SELECT DISTINCT d, a.author_did, a.author_handle AS handle
        FROM days
        JOIN site_standard_articles a ON DATE(a.created_at) = d
      )
      SELECT
        c.d::text AS day,
        COUNT(*) FILTER (WHERE p.author_did IS NOT NULL) AS retained,
        COUNT(*) FILTER (WHERE p.author_did IS NULL) AS new_authors,
        (SELECT COUNT(DISTINCT p2.author_did) FROM prev p2
         LEFT JOIN curr c2 ON c2.d = p2.d AND c2.author_did = p2.author_did
         WHERE c2.author_did IS NULL AND p2.d = c.d) AS churned,
        COUNT(*) FILTER (WHERE p.author_did IS NOT NULL AND (c.handle IS NULL OR c.handle NOT LIKE '%.web.brid.gy')) AS retained_native,
        COUNT(*) FILTER (WHERE p.author_did IS NULL AND (c.handle IS NULL OR c.handle NOT LIKE '%.web.brid.gy')) AS new_native,
        (SELECT COUNT(DISTINCT p2.author_did) FROM prev p2
         LEFT JOIN curr c2 ON c2.d = p2.d AND c2.author_did = p2.author_did
         WHERE c2.author_did IS NULL AND p2.d = c.d
           AND (p2.handle IS NULL OR p2.handle NOT LIKE '%.web.brid.gy')) AS churned_native,
        COUNT(*) FILTER (WHERE p.author_did IS NOT NULL AND c.handle LIKE '%.web.brid.gy') AS retained_bridgyfed,
        COUNT(*) FILTER (WHERE p.author_did IS NULL AND c.handle LIKE '%.web.brid.gy') AS new_bridgyfed,
        (SELECT COUNT(DISTINCT p2.author_did) FROM prev p2
         LEFT JOIN curr c2 ON c2.d = p2.d AND c2.author_did = p2.author_did
         WHERE c2.author_did IS NULL AND p2.d = c.d
           AND p2.handle LIKE '%.web.brid.gy') AS churned_bridgyfed
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
        COUNT(*) AS posts,
        COUNT(*) FILTER (WHERE author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy') AS posts_native,
        COUNT(*) FILTER (WHERE author_handle LIKE '%.web.brid.gy') AS posts_bridgyfed
      FROM site_standard_articles
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY dow, hour
      ORDER BY dow, hour
    `),

    // Top 20 sites this week (all)
    db.query(`
      SELECT REGEXP_REPLACE(site, '^https?://(www\\.)?', '') AS site, COUNT(*) AS posts
      FROM site_standard_articles
      WHERE created_at >= NOW() - INTERVAL '7 days' AND site IS NOT NULL AND site != ''
      GROUP BY REGEXP_REPLACE(site, '^https?://(www\\.)?', '')
      ORDER BY posts DESC LIMIT 20
    `),
    // Top 20 sites (native only)
    db.query(`
      SELECT REGEXP_REPLACE(site, '^https?://(www\\.)?', '') AS site, COUNT(*) AS posts
      FROM site_standard_articles
      WHERE created_at >= NOW() - INTERVAL '7 days' AND site IS NOT NULL AND site != ''
        AND (author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy')
      GROUP BY REGEXP_REPLACE(site, '^https?://(www\\.)?', '')
      ORDER BY posts DESC LIMIT 20
    `),
    // Top 20 sites (bridgyfed only)
    db.query(`
      SELECT REGEXP_REPLACE(site, '^https?://(www\\.)?', '') AS site, COUNT(*) AS posts
      FROM site_standard_articles
      WHERE created_at >= NOW() - INTERVAL '7 days' AND site IS NOT NULL AND site != ''
        AND author_handle LIKE '%.web.brid.gy'
      GROUP BY REGEXP_REPLACE(site, '^https?://(www\\.)?', '')
      ORDER BY posts DESC LIMIT 20
    `),

    // Language distribution (all)
    db.query(`
      SELECT COALESCE(language, 'unknown') AS language, COUNT(*) AS count
      FROM site_standard_articles WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY language ORDER BY count DESC LIMIT 12
    `),
    // Language distribution (native only)
    db.query(`
      SELECT COALESCE(language, 'unknown') AS language, COUNT(*) AS count
      FROM site_standard_articles
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND (author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy')
      GROUP BY language ORDER BY count DESC LIMIT 12
    `),
    // Language distribution (bridgyfed only)
    db.query(`
      SELECT COALESCE(language, 'unknown') AS language, COUNT(*) AS count
      FROM site_standard_articles
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND author_handle LIKE '%.web.brid.gy'
      GROUP BY language ORDER BY count DESC LIMIT 12
    `),

    // New authors per day 30 days (first-time publishers)
    db.query(`
      SELECT
        DATE(sub.first_seen) AS day,
        COUNT(*) AS new_authors,
        COUNT(*) FILTER (WHERE sub.handle IS NULL OR sub.handle NOT LIKE '%.web.brid.gy') AS new_native,
        COUNT(*) FILTER (WHERE sub.handle LIKE '%.web.brid.gy') AS new_bridgyfed
      FROM (
        SELECT author_did, MIN(created_at) AS first_seen, MAX(author_handle) AS handle
        FROM site_standard_articles
        GROUP BY author_did
      ) sub
      WHERE sub.first_seen >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(sub.first_seen)
      ORDER BY DATE(sub.first_seen)
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
    waa_native: Number(kpi.waa_native),
    waa_bridgyfed: Number(kpi.waa_bridgyfed),
    daa_native: Number(kpi.daa_native),
    daa_bridgyfed: Number(kpi.daa_bridgyfed),
    posts_native: Number(kpi.posts_native),
    posts_bridgyfed: Number(kpi.posts_bridgyfed),
    totalAuthors_native: Number(kpi.total_authors_native),
    totalAuthors_bridgyfed: Number(kpi.total_authors_bridgyfed),
    totalPosts_native: Number(kpi.total_posts_native),
    totalPosts_bridgyfed: Number(kpi.total_posts_bridgyfed),
    waaTrend: waaTrendRows.rows.map((r: any) => ({ day: r.day.toISOString().slice(0, 10), waa: Number(r.waa), waa_native: Number(r.waa_native), waa_bridgyfed: Number(r.waa_bridgyfed) })),
    dailyActivity: dailyRows.rows.map((r: any) => ({ day: r.day.toISOString().slice(0, 10), posts: Number(r.posts), authors: Number(r.authors), posts_native: Number(r.posts_native), posts_bridgyfed: Number(r.posts_bridgyfed), authors_native: Number(r.authors_native), authors_bridgyfed: Number(r.authors_bridgyfed) })),
    retention: retentionRows.rows.map((r: any) => ({ day: r.day.slice(0, 10), retained: Number(r.retained), new_authors: Number(r.new_authors), churned: Number(r.churned), retained_native: Number(r.retained_native), new_native: Number(r.new_native), churned_native: Number(r.churned_native), retained_bridgyfed: Number(r.retained_bridgyfed), new_bridgyfed: Number(r.new_bridgyfed), churned_bridgyfed: Number(r.churned_bridgyfed) })),
    hourlyHeatmap: heatmapRows.rows.map((r: any) => ({ dow: Number(r.dow), hour: Number(r.hour), posts: Number(r.posts), posts_native: Number(r.posts_native), posts_bridgyfed: Number(r.posts_bridgyfed) })),
    topSites: topSiteRows.rows.map((r: any) => ({ site: r.site, posts: Number(r.posts) })),
    topSitesNative: topSiteNativeRows.rows.map((r: any) => ({ site: r.site, posts: Number(r.posts) })),
    topSitesBridgyfed: topSiteBridgyfedRows.rows.map((r: any) => ({ site: r.site, posts: Number(r.posts) })),
    languages: languageRows.rows.map((r: any) => ({ language: r.language, count: Number(r.count) })),
    languagesNative: languageNativeRows.rows.map((r: any) => ({ language: r.language, count: Number(r.count) })),
    languagesBridgyfed: languageBridgyfedRows.rows.map((r: any) => ({ language: r.language, count: Number(r.count) })),
    newAuthors: newAuthorRows.rows.map((r: any) => ({ day: r.day.toISOString().slice(0, 10), new_authors: Number(r.new_authors), new_native: Number(r.new_native), new_bridgyfed: Number(r.new_bridgyfed) })),
    updatedAt: new Date().toISOString(),
  };

  return data;
}

export async function getBlogStats(): Promise<BlogStats> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.data;
  }
  const data = await _fetchStats();
  _cache = { data, fetchedAt: Date.now() };
  return data;
}

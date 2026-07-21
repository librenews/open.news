import { db, pool } from '../../db/client.js';
import { getRedis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

/**
 * Safe publication-date expression: uses published_at when available and not
 * in the future, otherwise falls back to created_at (ingestion time).
 * This prevents archive backfills from inflating weekly activity stats.
 */
const PUB_DATE = `COALESCE(CASE WHEN published_at > NOW() THEN created_at ELSE published_at END, created_at)`;

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

  // Verification
  totalVerified: number;
  totalUnverified: number;
  totalUnchecked: number;

  // Verified KPI breakout
  waa_verified: number;
  daa_verified: number;
  posts_verified: number;
  totalAuthors_verified: number;
  totalPosts_verified: number;

  // 30-day trend (WAA rolling)
  waaTrend: { day: string; waa: number; waa_native: number; waa_bridgyfed: number; waa_verified: number }[];

  // 30-day daily posts + authors
  dailyActivity: { day: string; posts: number; authors: number; posts_native: number; posts_bridgyfed: number; authors_native: number; authors_bridgyfed: number; posts_verified: number; authors_verified: number }[];

  // 14-day retention (with native/bridgyfed/verified split)
  retention: { day: string; retained: number; new_authors: number; churned: number;
    retained_native: number; new_native: number; churned_native: number;
    retained_bridgyfed: number; new_bridgyfed: number; churned_bridgyfed: number;
    retained_verified: number; new_verified: number; churned_verified: number }[];

  // Hourly heatmap last 7 days (day 0-6, hour 0-23)
  hourlyHeatmap: { dow: number; hour: number; posts: number; posts_native: number; posts_bridgyfed: number; posts_verified: number }[];

  // Top 20 sites this week (all, native-only, bridgyfed-only, verified-only)
  topSites: { site: string; posts: number }[];
  topSitesNative: { site: string; posts: number }[];
  topSitesBridgyfed: { site: string; posts: number }[];
  topSitesVerified: { site: string; posts: number }[];

  // Language distribution (all, native-only, bridgyfed-only, verified-only)
  languages: { language: string; count: number }[];
  languagesNative: { language: string; count: number }[];
  languagesBridgyfed: { language: string; count: number }[];
  languagesVerified: { language: string; count: number }[];

  // New authors per day (30 days)
  newAuthors: { day: string; new_authors: number; new_native: number; new_bridgyfed: number; new_verified: number }[];

  updatedAt: string;
}


let _cache: StatsCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let _warmingPromise: Promise<void> | null = null;
const REDIS_STATS_KEY = 'blogs:stats:cache';

/** Save the current cache to Redis for persistence across restarts. */
async function _persistToRedis(data: BlogStats): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(REDIS_STATS_KEY, JSON.stringify(data), 'EX', 86400); // 24h TTL
  } catch (err) {
    logger.warn({ err }, 'Failed to persist stats cache to Redis');
  }
}

/** Load cached stats from Redis (returns null if missing/corrupt). */
async function _loadFromRedis(): Promise<BlogStats | null> {
  try {
    const redis = getRedis();
    const raw = await redis.get(REDIS_STATS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BlogStats;
  } catch (err) {
    logger.warn({ err }, 'Failed to load stats cache from Redis');
    return null;
  }
}

/** Force-refresh the stats cache (ignores TTL). */
async function warmStatsCache(): Promise<void> {
  const data = await _fetchStats();
  _cache = { data, fetchedAt: Date.now() };
  _persistToRedis(data).catch(() => {}); // fire-and-forget
}

/** Start a tracked warm — so getBlogStats can join it instead of spawning another. */
export function startStatsWarm(): void {
  if (_warmingPromise) return; // already warming
  _warmingPromise = warmStatsCache()
    .catch((err) => logger.error({ err }, 'Stats warm failed'))
    .finally(() => { _warmingPromise = null; });
}

export async function getBlogStats(): Promise<BlogStats> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.data;
  }
  // Try loading from Redis if in-memory cache is empty (post-restart)
  if (!_cache) {
    const redisData = await _loadFromRedis();
    if (redisData) {
      _cache = { data: redisData, fetchedAt: Date.now() };
      // Kick off a background refresh so data becomes fresh
      if (!_warmingPromise) {
        _warmingPromise = warmStatsCache().finally(() => { _warmingPromise = null; });
      }
      return redisData;
    }
  }
  // If a warm is already in progress, wait for it instead of spawning another
  if (_warmingPromise) {
    await _warmingPromise;
    if (_cache) return _cache.data;
  }
  _warmingPromise = warmStatsCache();
  await _warmingPromise;
  _warmingPromise = null;
  return _cache!.data;
}

async function _fetchStats(): Promise<BlogStats> {
  // Use a single client to avoid exhausting the pool (14 queries would need 14 connections with Promise.all)
  const client = await pool.connect();
  try {
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
    topSiteVerifiedRows,
    languageVerifiedRows,
    newAuthorRows,
  ] = await Promise.all([
    // Hero KPIs — uses published_at (with fallback) for activity windows
    client.query(`
      SELECT
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE ${PUB_DATE} >= NOW() - INTERVAL '7 days') AS waa,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE ${PUB_DATE} >= NOW() - INTERVAL '7 days'
           AND (author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy')) AS waa_native,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE ${PUB_DATE} >= NOW() - INTERVAL '7 days'
           AND author_handle LIKE '%.web.brid.gy') AS waa_bridgyfed,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE DATE(${PUB_DATE}) = CURRENT_DATE - 1) AS daa,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE DATE(${PUB_DATE}) = CURRENT_DATE - 1
           AND (author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy')) AS daa_native,
        (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
         WHERE DATE(${PUB_DATE}) = CURRENT_DATE - 1
           AND author_handle LIKE '%.web.brid.gy') AS daa_bridgyfed,
        (SELECT COUNT(*) FROM site_standard_articles
         WHERE DATE(${PUB_DATE}) = CURRENT_DATE - 1) AS posts_yesterday,
        (SELECT COUNT(*) FROM site_standard_articles
         WHERE DATE(${PUB_DATE}) = CURRENT_DATE - 1
           AND (author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy')) AS posts_native,
        (SELECT COUNT(*) FROM site_standard_articles
         WHERE DATE(${PUB_DATE}) = CURRENT_DATE - 1
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
           SELECT DATE(${PUB_DATE}) AS d, COUNT(*) / NULLIF(COUNT(DISTINCT author_did), 0) AS daily_posts
           FROM site_standard_articles
           WHERE ${PUB_DATE} >= NOW() - INTERVAL '14 days'
             AND EXTRACT(DOW FROM ${PUB_DATE}) BETWEEN 1 AND 5
           GROUP BY DATE(${PUB_DATE})
         ) sub) AS avg_posts_per_author,
         (SELECT COUNT(*) FROM site_standard_articles WHERE verified = true) AS total_verified,
         (SELECT COUNT(*) FROM site_standard_articles WHERE verified = false) AS total_unverified,
         (SELECT COUNT(*) FROM site_standard_articles WHERE verified IS NULL) AS total_unchecked,
         (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
          WHERE ${PUB_DATE} >= NOW() - INTERVAL '7 days' AND verified = true) AS waa_verified,
         (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
          WHERE DATE(${PUB_DATE}) = CURRENT_DATE - 1 AND verified = true) AS daa_verified,
         (SELECT COUNT(*) FROM site_standard_articles
          WHERE DATE(${PUB_DATE}) = CURRENT_DATE - 1 AND verified = true) AS posts_yesterday_verified,
         (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles
          WHERE verified = true) AS total_authors_verified,
         (SELECT COUNT(*) FROM site_standard_articles
          WHERE verified = true) AS total_posts_verified
    `),

    // WAA 30-day rolling trend — uses published_at
    client.query(`
      SELECT
        DATE(gs.day) AS day,
        COUNT(DISTINCT a.author_did) AS waa,
        COUNT(DISTINCT a.author_did) FILTER (WHERE a.author_handle IS NULL OR a.author_handle NOT LIKE '%.web.brid.gy') AS waa_native,
        COUNT(DISTINCT a.author_did) FILTER (WHERE a.author_handle LIKE '%.web.brid.gy') AS waa_bridgyfed,
        COUNT(DISTINCT a.author_did) FILTER (WHERE a.verified = true) AS waa_verified
      FROM generate_series(NOW() - INTERVAL '30 days', NOW(), INTERVAL '1 day') AS gs(day)
      JOIN site_standard_articles a
        ON ${PUB_DATE} >= gs.day - INTERVAL '7 days'
        AND ${PUB_DATE} < gs.day
      GROUP BY DATE(gs.day)
      ORDER BY DATE(gs.day)
    `),

    // Daily activity 30 days — uses published_at
    client.query(`
      SELECT
        DATE(${PUB_DATE}) AS day,
        COUNT(*) AS posts,
        COUNT(DISTINCT author_did) AS authors,
        COUNT(*) FILTER (WHERE author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy') AS posts_native,
        COUNT(*) FILTER (WHERE author_handle LIKE '%.web.brid.gy') AS posts_bridgyfed,
        COUNT(DISTINCT author_did) FILTER (WHERE author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy') AS authors_native,
        COUNT(DISTINCT author_did) FILTER (WHERE author_handle LIKE '%.web.brid.gy') AS authors_bridgyfed,
        COUNT(*) FILTER (WHERE verified = true) AS posts_verified,
        COUNT(DISTINCT author_did) FILTER (WHERE verified = true) AS authors_verified
      FROM site_standard_articles
      WHERE ${PUB_DATE} >= NOW() - INTERVAL '30 days'
        AND ${PUB_DATE} < DATE_TRUNC('day', NOW())
      GROUP BY DATE(${PUB_DATE})
      ORDER BY DATE(${PUB_DATE})
    `),

    // 14-day retention with native/bridgyfed/verified split
    client.query(`
      WITH days AS (
        SELECT generate_series(NOW() - INTERVAL '14 days', NOW() - INTERVAL '1 day', INTERVAL '1 day')::date AS d
      ),
      prev AS (
        SELECT d, a.author_did, MAX(a.author_handle) AS handle, bool_or(a.verified) AS has_verified
        FROM days
        JOIN site_standard_articles a ON DATE(a.created_at) = d - 1
        GROUP BY d, a.author_did
      ),
      curr AS (
        SELECT d, a.author_did, MAX(a.author_handle) AS handle, bool_or(a.verified) AS has_verified
        FROM days
        JOIN site_standard_articles a ON DATE(a.created_at) = d
        GROUP BY d, a.author_did
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
           AND p2.handle LIKE '%.web.brid.gy') AS churned_bridgyfed,
        COUNT(*) FILTER (WHERE p.author_did IS NOT NULL AND c.has_verified) AS retained_verified,
        COUNT(*) FILTER (WHERE p.author_did IS NULL AND c.has_verified) AS new_verified,
        (SELECT COUNT(DISTINCT p2.author_did) FROM prev p2
         LEFT JOIN curr c2 ON c2.d = p2.d AND c2.author_did = p2.author_did
         WHERE c2.author_did IS NULL AND p2.d = c.d
           AND p2.has_verified) AS churned_verified
      FROM curr c
      LEFT JOIN prev p USING (d, author_did)
      GROUP BY c.d
      ORDER BY c.d
    `),

    // Hourly heatmap last 7 days — uses published_at
    client.query(`
      SELECT
        EXTRACT(DOW FROM ${PUB_DATE})::int AS dow,
        EXTRACT(HOUR FROM ${PUB_DATE})::int AS hour,
        COUNT(*) AS posts,
        COUNT(*) FILTER (WHERE author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy') AS posts_native,
        COUNT(*) FILTER (WHERE author_handle LIKE '%.web.brid.gy') AS posts_bridgyfed,
        COUNT(*) FILTER (WHERE verified = true) AS posts_verified
      FROM site_standard_articles
      WHERE ${PUB_DATE} >= NOW() - INTERVAL '7 days'
      GROUP BY dow, hour
      ORDER BY dow, hour
    `),

    // Top 20 sites this week (all) — uses published_at
    client.query(`
      SELECT REGEXP_REPLACE(site, '^https?://(www\\.)?', '') AS site, COUNT(*) AS posts
      FROM site_standard_articles
      WHERE ${PUB_DATE} >= NOW() - INTERVAL '7 days' AND site IS NOT NULL AND site != ''
      GROUP BY REGEXP_REPLACE(site, '^https?://(www\\.)?', '')
      ORDER BY posts DESC LIMIT 20
    `),
    // Top 20 sites (native only) — uses published_at
    client.query(`
      SELECT REGEXP_REPLACE(site, '^https?://(www\\.)?', '') AS site, COUNT(*) AS posts
      FROM site_standard_articles
      WHERE ${PUB_DATE} >= NOW() - INTERVAL '7 days' AND site IS NOT NULL AND site != ''
        AND (author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy')
      GROUP BY REGEXP_REPLACE(site, '^https?://(www\\.)?', '')
      ORDER BY posts DESC LIMIT 20
    `),
    // Top 20 sites (bridgyfed only) — uses published_at
    client.query(`
      SELECT REGEXP_REPLACE(site, '^https?://(www\\.)?', '') AS site, COUNT(*) AS posts
      FROM site_standard_articles
      WHERE ${PUB_DATE} >= NOW() - INTERVAL '7 days' AND site IS NOT NULL AND site != ''
        AND author_handle LIKE '%.web.brid.gy'
      GROUP BY REGEXP_REPLACE(site, '^https?://(www\\.)?', '')
      ORDER BY posts DESC LIMIT 20
    `),

    // Language distribution (all) — uses published_at
    client.query(`
      SELECT COALESCE(language, 'unknown') AS language, COUNT(*) AS count
      FROM site_standard_articles WHERE ${PUB_DATE} >= NOW() - INTERVAL '30 days'
      GROUP BY language ORDER BY count DESC LIMIT 12
    `),
    // Language distribution (native only) — uses published_at
    client.query(`
      SELECT COALESCE(language, 'unknown') AS language, COUNT(*) AS count
      FROM site_standard_articles
      WHERE ${PUB_DATE} >= NOW() - INTERVAL '30 days'
        AND (author_handle IS NULL OR author_handle NOT LIKE '%.web.brid.gy')
      GROUP BY language ORDER BY count DESC LIMIT 12
    `),
    // Language distribution (bridgyfed only) — uses published_at
    client.query(`
      SELECT COALESCE(language, 'unknown') AS language, COUNT(*) AS count
      FROM site_standard_articles
      WHERE ${PUB_DATE} >= NOW() - INTERVAL '30 days'
        AND author_handle LIKE '%.web.brid.gy'
      GROUP BY language ORDER BY count DESC LIMIT 12
    `),

    // Top 20 sites (verified only) — uses published_at
    client.query(`
      SELECT REGEXP_REPLACE(site, '^https?://(www\\.)?', '') AS site, COUNT(*) AS posts
      FROM site_standard_articles
      WHERE ${PUB_DATE} >= NOW() - INTERVAL '7 days' AND site IS NOT NULL AND site != ''
        AND verified = true
      GROUP BY REGEXP_REPLACE(site, '^https?://(www\\.)?', '')
      ORDER BY posts DESC LIMIT 20
    `),

    // Language distribution (verified only) — uses published_at
    client.query(`
      SELECT COALESCE(language, 'unknown') AS language, COUNT(*) AS count
      FROM site_standard_articles
      WHERE ${PUB_DATE} >= NOW() - INTERVAL '30 days'
        AND verified = true
      GROUP BY language ORDER BY count DESC LIMIT 12
    `),

    // New authors per day 30 days (first-time publishers)
    client.query(`
      SELECT
        DATE(sub.first_seen) AS day,
        COUNT(*) AS new_authors,
        COUNT(*) FILTER (WHERE sub.handle IS NULL OR sub.handle NOT LIKE '%.web.brid.gy') AS new_native,
        COUNT(*) FILTER (WHERE sub.handle LIKE '%.web.brid.gy') AS new_bridgyfed,
        COUNT(*) FILTER (WHERE sub.has_verified) AS new_verified
      FROM (
        SELECT author_did, MIN(created_at) AS first_seen, MAX(author_handle) AS handle,
               bool_or(verified) AS has_verified
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
    totalVerified: Number(kpi.total_verified),
    totalUnverified: Number(kpi.total_unverified),
    totalUnchecked: Number(kpi.total_unchecked),
    waa_verified: Number(kpi.waa_verified),
    daa_verified: Number(kpi.daa_verified),
    posts_verified: Number(kpi.posts_yesterday_verified),
    totalAuthors_verified: Number(kpi.total_authors_verified),
    totalPosts_verified: Number(kpi.total_posts_verified),
    waaTrend: waaTrendRows.rows.map((r: any) => ({ day: r.day.toISOString().slice(0, 10), waa: Number(r.waa), waa_native: Number(r.waa_native), waa_bridgyfed: Number(r.waa_bridgyfed), waa_verified: Number(r.waa_verified) })),
    dailyActivity: dailyRows.rows.map((r: any) => ({ day: r.day.toISOString().slice(0, 10), posts: Number(r.posts), authors: Number(r.authors), posts_native: Number(r.posts_native), posts_bridgyfed: Number(r.posts_bridgyfed), authors_native: Number(r.authors_native), authors_bridgyfed: Number(r.authors_bridgyfed), posts_verified: Number(r.posts_verified), authors_verified: Number(r.authors_verified) })),
    retention: retentionRows.rows.map((r: any) => ({ day: r.day.slice(0, 10), retained: Number(r.retained), new_authors: Number(r.new_authors), churned: Number(r.churned), retained_native: Number(r.retained_native), new_native: Number(r.new_native), churned_native: Number(r.churned_native), retained_bridgyfed: Number(r.retained_bridgyfed), new_bridgyfed: Number(r.new_bridgyfed), churned_bridgyfed: Number(r.churned_bridgyfed), retained_verified: Number(r.retained_verified), new_verified: Number(r.new_verified), churned_verified: Number(r.churned_verified) })),
    hourlyHeatmap: heatmapRows.rows.map((r: any) => ({ dow: Number(r.dow), hour: Number(r.hour), posts: Number(r.posts), posts_native: Number(r.posts_native), posts_bridgyfed: Number(r.posts_bridgyfed), posts_verified: Number(r.posts_verified) })),
    topSites: topSiteRows.rows.map((r: any) => ({ site: r.site, posts: Number(r.posts) })),
    topSitesNative: topSiteNativeRows.rows.map((r: any) => ({ site: r.site, posts: Number(r.posts) })),
    topSitesBridgyfed: topSiteBridgyfedRows.rows.map((r: any) => ({ site: r.site, posts: Number(r.posts) })),
    topSitesVerified: topSiteVerifiedRows.rows.map((r: any) => ({ site: r.site, posts: Number(r.posts) })),
    languages: languageRows.rows.map((r: any) => ({ language: r.language, count: Number(r.count) })),
    languagesNative: languageNativeRows.rows.map((r: any) => ({ language: r.language, count: Number(r.count) })),
    languagesBridgyfed: languageBridgyfedRows.rows.map((r: any) => ({ language: r.language, count: Number(r.count) })),
    languagesVerified: languageVerifiedRows.rows.map((r: any) => ({ language: r.language, count: Number(r.count) })),
    newAuthors: newAuthorRows.rows.map((r: any) => ({ day: r.day.toISOString().slice(0, 10), new_authors: Number(r.new_authors), new_native: Number(r.new_native), new_bridgyfed: Number(r.new_bridgyfed), new_verified: Number(r.new_verified) })),
    updatedAt: new Date().toISOString(),
  };

  return data;
  } finally {
    client.release();
  }
}

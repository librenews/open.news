import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Manually parse .env to avoid external dependencies like dotenv
const envFile = resolve(process.cwd(), '.env');
try {
  const content = readFileSync(envFile, 'utf8');
  content.split('\n').forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq === -1) return;
    process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  });
} catch (e) {
  console.warn("Could not read .env file, relying on environment variables:", (e as Error).message);
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  console.log("Starting query diagnostic...");
  console.log("Database URL:", process.env.DATABASE_URL ? "Configured" : "MISSING");

  try {
    const tableCounts = await pool.query(`
      SELECT 
        (SELECT count(*) FROM site_standard_articles) as articles_count,
        (SELECT count(*) FROM article_interactions) as interactions_count
    `);
    console.log("Table Row Counts:");
    console.log("-----------------");
    console.log("site_standard_articles count:", tableCounts.rows[0].articles_count);
    console.log("article_interactions count:", tableCounts.rows[0].interactions_count);
    console.log("\n");

    // ─── Query 1: Longform Homepage Query ───
    console.log("Analyzing Query 1: Longform Homepage Query...");
    const longformExplain = await pool.query(`
      EXPLAIN (ANALYZE, BUFFERS)
      SELECT * FROM (
         SELECT DISTINCT ON (split_part(s.uri, '/', 5)) s.uri, s.author_did, s.title, s.description, s.published_at, COALESCE(p.url, s.site) as site, s.path, s.word_count,
           split_part(s.uri, '/', 4) AS collection,
           COALESCE(
             s.raw_record->'coverImage'->'ref'->>'$link',
             s.raw_record->'images'->0->'image'->'ref'->>'$link',
             s.raw_record->'images'->0->'ref'->>'$link'
           ) AS image_cid,
           CASE WHEN s.raw_record->>'site' LIKE 'at://%site.standard.publication%'
             THEN s.raw_record->>'site'
             ELSE NULL
           END AS publication_uri,
           s.raw_record->>'tags' AS tags_json
         FROM site_standard_articles s
         LEFT JOIN site_publications p ON p.uri = s.raw_record->>'site'
         WHERE s.word_count > 100
           AND s.language = 'eng'
           AND s.suppressed = false
           AND s.published_at > NOW() - INTERVAL '30 days'
         ORDER BY split_part(s.uri, '/', 5), s.published_at DESC NULLS LAST
       ) sub ORDER BY published_at DESC NULLS LAST
       LIMIT 40
    `);
    console.log("Longform Explain Plan:");
    console.log("======================");
    console.log(longformExplain.rows.map(r => r['QUERY PLAN']).join('\n'));
    console.log("\n");

    // ─── Query 2: Blogs Trending Query ───
    console.log("Analyzing Query 2: Blogs Trending Query...");
    const blogsExplain = await pool.query(`
      EXPLAIN (ANALYZE, BUFFERS)
      WITH interacted AS (
        SELECT s.uri, s.author_did, s.title, s.site, s.path,
               s.published_at, s.word_count, s.created_at,
               COALESCE(s.description, s.raw_record->>'content', s.raw_record->>'textContent') AS text_content,
               s.raw_record->'tags' AS tags_json,
               COALESCE(
                 s.raw_record->'coverImage'->'ref'->>'$link',
                 s.raw_record->'images'->0->'image'->'ref'->>'$link',
                 s.raw_record->'images'->0->'ref'->>'$link'
               ) AS cover_cid,
               COALESCE(c.like_count, 0) AS like_count,
               COALESCE(c.share_count, 0) AS share_count,
               (COALESCE(c.like_count, 0) + COALESCE(c.share_count, 0) * 2 + 1)::float
                 / POWER(GREATEST(EXTRACT(EPOCH FROM (NOW() - s.published_at)) / 3600.0, 0) + 2, 1.3) AS hotness
        FROM (
          SELECT article_uri,
            COUNT(CASE WHEN interaction_type = 'like' THEN 1 END)::int AS like_count,
            COUNT(CASE WHEN interaction_type IN ('share','repost') THEN 1 END)::int AS share_count
          FROM article_interactions
          GROUP BY article_uri
        ) c
        JOIN site_standard_articles s ON s.uri = c.article_uri
        WHERE s.verified = true
          AND s.suppressed IS NOT TRUE
          AND s.published_at > NOW() - INTERVAL '14 days'
      ),
      backfill AS (
        SELECT uri, author_did, title, site, path,
               published_at, word_count, created_at,
               COALESCE(description, raw_record->>'content', raw_record->>'textContent') AS text_content,
               raw_record->'tags' AS tags_json,
               COALESCE(
                 raw_record->'coverImage'->'ref'->>'$link',
                 raw_record->'images'->0->'image'->'ref'->>'$link',
                 raw_record->'images'->0->'ref'->>'$link'
               ) AS cover_cid,
               0 AS like_count, 0 AS share_count,
               1.0 / POWER(GREATEST(EXTRACT(EPOCH FROM (NOW() - published_at)) / 3600.0, 0) + 2, 1.3) AS hotness
        FROM site_standard_articles
        WHERE verified = true
          AND suppressed IS NOT TRUE
          AND published_at > NOW() - INTERVAL '3 days'
          AND uri NOT IN (SELECT uri FROM interacted)
        ORDER BY published_at DESC
        LIMIT 60
      ),
      combined AS (
        SELECT * FROM interacted
        UNION ALL
        SELECT * FROM backfill
      )
      SELECT combined.*,
        COALESCE(ul.user_liked, false) AS user_liked
      FROM combined
      LEFT JOIN LATERAL (
        SELECT true AS user_liked FROM article_interactions
        WHERE article_uri = combined.uri AND actor_did = '' AND interaction_type = 'like'
        LIMIT 1
      ) ul ON true
      ORDER BY hotness DESC
      LIMIT 30 OFFSET 0
    `);
    console.log("Blogs Explain Plan:");
    console.log("===================");
    console.log(blogsExplain.rows.map(r => r['QUERY PLAN']).join('\n'));
    console.log("\n");

  } catch (err) {
    console.error("Diagnostic failed:", err);
  } finally {
    await pool.end();
  }
}

main();

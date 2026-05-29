/**
 * Backfill doc_feed_bridge from existing verified articles that have bskyPostRef.
 * 
 * Usage: node --env-file=.env --import tsx/esm src/scripts/backfillDocBridge.ts
 */
import { db } from '../db/client.js';

async function main() {
  // Ensure table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS doc_feed_bridge (
      doc_uri       TEXT PRIMARY KEY,
      post_uri      TEXT NOT NULL,
      source        TEXT NOT NULL DEFAULT 'organic',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dfb_post ON doc_feed_bridge(post_uri)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dfb_created ON doc_feed_bridge(created_at DESC)`);

  // Find verified articles with bskyPostRef
  const { rows } = await db.query(`
    SELECT uri, raw_record->'bskyPostRef'->>'uri' AS bsky_post_uri
    FROM site_standard_articles
    WHERE verified = true
      AND raw_record->'bskyPostRef'->>'uri' IS NOT NULL
  `);

  console.log(`Found ${rows.length} verified articles with bskyPostRef`);

  let inserted = 0;
  for (const row of rows) {
    try {
      const res = await db.query(
        `INSERT INTO doc_feed_bridge (doc_uri, post_uri, source)
         VALUES ($1, $2, 'organic')
         ON CONFLICT (doc_uri) DO NOTHING`,
        [row.uri, row.bsky_post_uri]
      );
      if (res.rowCount && res.rowCount > 0) inserted++;
    } catch (err: any) {
      console.error(`  Failed: ${row.uri} — ${err.message}`);
    }
  }

  console.log(`✅ Inserted ${inserted} bridge records (${rows.length - inserted} already existed)`);

  // Show a sample
  const { rows: sample } = await db.query(`
    SELECT b.doc_uri, b.post_uri, a.title, a.raw_record->>'site' as pub_uri
    FROM doc_feed_bridge b
    JOIN site_standard_articles a ON a.uri = b.doc_uri
    ORDER BY a.published_at DESC
    LIMIT 5
  `);
  console.log(`\nSample bridge entries:`);
  for (const s of sample) {
    console.log(`  ${s.title?.substring(0, 60)} → ${s.post_uri}`);
  }

  // Count total
  const { rows: [{ count }] } = await db.query('SELECT COUNT(*) as count FROM doc_feed_bridge');
  console.log(`\nTotal bridge entries: ${count}`);

  await db.end();
}

main().catch((err) => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});

/**
 * Query feed visit stats for geo/city tracks published via nearby.at
 *
 * Usage: node --env-file=.env --import tsx/esm src/scripts/geoFeedStats.ts [days]
 */
import { pool } from '../db/client.js';

const days = parseInt(process.argv[2] || '7', 10);

async function main() {
  // Find tracks that look like geo/city feeds (have place_id or geo-related keywords)
  // Since geo tracks are just regular tracks, we join on feed_requests to get stats
  const { rows: tracks } = await pool.query(`
    SELECT
      t.uuid,
      t.name,
      t.query,
      t.feed_published,
      t.owner_did,
      COUNT(fr.id) AS total_requests,
      COUNT(DISTINCT fr.requester_did) AS unique_viewers,
      MIN(fr.created_at) AS first_request,
      MAX(fr.created_at) AS last_request
    FROM tracks t
    LEFT JOIN feed_requests fr
      ON fr.feed_name = t.uuid
      AND fr.created_at > NOW() - INTERVAL '${days} days'
    WHERE t.feed_published = true
    GROUP BY t.id, t.uuid, t.name, t.query, t.feed_published, t.owner_did
    HAVING COUNT(fr.id) > 0
    ORDER BY COUNT(fr.id) DESC
  `);

  if (tracks.length === 0) {
    console.log(`\nNo published feeds with requests in the last ${days} days.`);

    // Show all published feeds anyway
    const { rows: allPublished } = await pool.query(`
      SELECT uuid, name, query, owner_did FROM tracks WHERE feed_published = true ORDER BY created_at DESC
    `);
    console.log(`\n📋 All published feeds (${allPublished.length}):`);
    for (const t of allPublished) {
      console.log(`  ${t.name} (${t.uuid}) — query: "${t.query?.substring(0, 60)}..."`);
    }
  } else {
    console.log(`\n📊 Feed stats for last ${days} days:\n`);
    console.log('Feed Name'.padEnd(40) + 'Requests'.padStart(10) + 'Unique'.padStart(10) + '  Last Request');
    console.log('-'.repeat(85));

    for (const t of tracks) {
      const lastReq = t.last_request ? new Date(t.last_request).toISOString().slice(0, 16) : 'n/a';
      console.log(
        (t.name || 'Untitled').substring(0, 38).padEnd(40) +
        String(t.total_requests).padStart(10) +
        String(t.unique_viewers).padStart(10) +
        `  ${lastReq}`
      );
    }

    const totalReqs = tracks.reduce((s, t) => s + parseInt(t.total_requests), 0);
    const totalUniq = tracks.reduce((s, t) => s + parseInt(t.unique_viewers), 0);
    console.log('-'.repeat(85));
    console.log('TOTAL'.padEnd(40) + String(totalReqs).padStart(10) + String(totalUniq).padStart(10));
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

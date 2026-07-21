/**
 * All Feeds Metrics Report
 *
 * Queries usage metrics for every feed created via feeds.social (custom_feeds)
 * and via track (tracks), by joining against feed_requests.
 *
 * Usage: node --env-file=.env --import tsx/esm src/scripts/allFeedsMetrics.ts [days]
 */
import { pool } from '../db/client.js';

const days = parseInt(process.argv[2] || '7', 10);

async function main() {
  console.log(`\n🔍 All Feeds Metrics Report — last ${days} days`);
  console.log('═'.repeat(100));

  // ────────────────────────────────────────────────────────────
  // 1. feeds.social (custom_feeds) usage
  // ────────────────────────────────────────────────────────────
  console.log('\n📰 feeds.social Custom Feeds:\n');

  const { rows: customFeeds } = await pool.query(`
    SELECT
      cf.id,
      cf.name,
      cf.query,
      cf.feed_type,
      cf.is_public,
      cf.bsky_uri,
      fu.handle AS owner_handle,
      cf.created_at AS feed_created,
      COUNT(fr.id)                    AS total_requests,
      COUNT(DISTINCT fr.requester_did) AS unique_users,
      MIN(fr.created_at)              AS first_request,
      MAX(fr.created_at)              AS last_request
    FROM custom_feeds cf
    LEFT JOIN feed_users fu ON fu.id = cf.owner_id
    LEFT JOIN feed_requests fr
      ON fr.feed_name = cf.uuid
      AND fr.created_at > NOW() - INTERVAL '${days} days'
    GROUP BY cf.id, cf.name, cf.query, cf.feed_type, cf.is_public, cf.bsky_uri,
             fu.handle, cf.created_at
    ORDER BY COUNT(fr.id) DESC, cf.created_at DESC
  `);

  if (customFeeds.length === 0) {
    console.log('  (no custom feeds found)');
  } else {
    console.log(
      'Feed Name'.padEnd(35) +
      'Owner'.padEnd(22) +
      'Type'.padEnd(7) +
      'Pub'.padEnd(5) +
      'Reqs'.padStart(8) +
      'Users'.padStart(8) +
      '  Last Active'
    );
    console.log('─'.repeat(100));

    let totalReqs = 0;
    let totalUniq = 0;
    for (const f of customFeeds) {
      const reqs = parseInt(f.total_requests, 10);
      const uniq = parseInt(f.unique_users, 10);
      totalReqs += reqs;
      totalUniq += uniq;
      const lastActive = f.last_request
        ? new Date(f.last_request).toISOString().slice(0, 16).replace('T', ' ')
        : '—';
      console.log(
        (f.name || 'Untitled').substring(0, 33).padEnd(35) +
        (f.owner_handle || 'anonymous').substring(0, 20).padEnd(22) +
        (f.feed_type || 'text').padEnd(7) +
        (f.is_public ? '✓' : '✗').padEnd(5) +
        String(reqs).padStart(8) +
        String(uniq).padStart(8) +
        `  ${lastActive}`
      );
    }
    console.log('─'.repeat(100));
    console.log(
      `TOTAL (${customFeeds.length} feeds)`.padEnd(69) +
      String(totalReqs).padStart(8) +
      String(totalUniq).padStart(8)
    );
  }

  // ────────────────────────────────────────────────────────────
  // 2. Track feeds usage
  // ────────────────────────────────────────────────────────────
  console.log('\n\n📡 Track Feeds:\n');

  const { rows: trackFeeds } = await pool.query(`
    SELECT
      t.id,
      t.name,
      t.query,
      t.uuid,
      t.feed_published,
      t.shadow,
      t.category,
      t.is_active,
      u.handle AS owner_handle,
      t.created_at AS feed_created,
      COUNT(fr.id)                    AS total_requests,
      COUNT(DISTINCT fr.requester_did) AS unique_users,
      MIN(fr.created_at)              AS first_request,
      MAX(fr.created_at)              AS last_request,
      (SELECT COUNT(*) FROM track_matches tm WHERE tm.track_id = t.id) AS total_matches
    FROM tracks t
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN feed_requests fr
      ON fr.feed_name = t.uuid::text
      AND fr.created_at > NOW() - INTERVAL '${days} days'
    GROUP BY t.id, t.name, t.query, t.uuid, t.feed_published, t.shadow, t.category,
             t.is_active, u.handle, t.created_at
    ORDER BY COUNT(fr.id) DESC, t.created_at DESC
  `);

  if (trackFeeds.length === 0) {
    console.log('  (no track feeds found)');
  } else {
    console.log(
      'Feed Name'.padEnd(30) +
      'Owner'.padEnd(18) +
      'Published'.padEnd(10) +
      'Active'.padEnd(8) +
      'Matches'.padStart(9) +
      'Reqs'.padStart(8) +
      'Users'.padStart(8) +
      '  Last Active'
    );
    console.log('─'.repeat(110));

    let totalReqs = 0;
    let totalUniq = 0;
    let totalMatches = 0;
    for (const t of trackFeeds) {
      const reqs = parseInt(t.total_requests, 10);
      const uniq = parseInt(t.unique_users, 10);
      const matches = parseInt(t.total_matches, 10);
      totalReqs += reqs;
      totalUniq += uniq;
      totalMatches += matches;
      const lastActive = t.last_request
        ? new Date(t.last_request).toISOString().slice(0, 16).replace('T', ' ')
        : '—';
      console.log(
        (t.name || 'Untitled').substring(0, 28).padEnd(30) +
        (t.owner_handle || '—').substring(0, 16).padEnd(18) +
        (t.feed_published ? '✓' : '✗').padEnd(10) +
        (t.is_active ? '✓' : '✗').padEnd(8) +
        String(matches).padStart(9) +
        String(reqs).padStart(8) +
        String(uniq).padStart(8) +
        `  ${lastActive}`
      );
    }
    console.log('─'.repeat(110));
    console.log(
      `TOTAL (${trackFeeds.length} tracks)`.padEnd(66) +
      String(totalMatches).padStart(9) +
      String(totalReqs).padStart(8) +
      String(totalUniq).padStart(8)
    );
  }

  // ────────────────────────────────────────────────────────────
  // 3. Overall summary
  // ────────────────────────────────────────────────────────────
  console.log('\n\n📊 Overall Summary:\n');

  const { rows: [overall] } = await pool.query(`
    SELECT
      COUNT(*) AS total_requests,
      COUNT(DISTINCT requester_did) AS unique_users,
      COUNT(DISTINCT feed_name) AS feeds_served
    FROM feed_requests
    WHERE created_at > NOW() - INTERVAL '${days} days'
  `);
  console.log(`  Total requests (last ${days}d):   ${overall.total_requests}`);
  console.log(`  Unique users (last ${days}d):     ${overall.unique_users}`);
  console.log(`  Distinct feeds served:        ${overall.feeds_served}`);

  // Daily breakdown
  console.log(`\n📅 Daily Breakdown (last ${days} days):\n`);
  const { rows: daily } = await pool.query(`
    SELECT
      date_trunc('day', created_at)::date AS day,
      COUNT(*) AS requests,
      COUNT(DISTINCT requester_did) AS unique_users,
      COUNT(DISTINCT feed_name) AS feeds_active
    FROM feed_requests
    WHERE created_at > NOW() - INTERVAL '${days} days'
    GROUP BY 1
    ORDER BY 1 DESC
  `);

  console.log('Date'.padEnd(14) + 'Requests'.padStart(10) + 'Users'.padStart(10) + 'Feeds'.padStart(10));
  console.log('─'.repeat(44));
  for (const d of daily) {
    const dateStr = new Date(d.day).toISOString().slice(0, 10);
    console.log(
      dateStr.padEnd(14) +
      String(d.requests).padStart(10) +
      String(d.unique_users).padStart(10) +
      String(d.feeds_active).padStart(10)
    );
  }

  console.log('\n✅ Report complete.\n');
  await pool.end();
}

main().catch((err) => {
  console.error('Error running report:', err);
  process.exit(1);
});

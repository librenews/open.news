/**
 * shadowReport.ts — Report on shadow track viability.
 *
 * Queries track_matches for shadow tracks and shows daily match rates,
 * viability tier (green/yellow/red), and category aggregates.
 *
 * Usage:
 *   npx tsx src/scripts/shadowReport.ts [days]
 */

import { db } from '../db/client.js';

const days = parseInt(process.argv[2] || '7', 10);

async function main() {
  // 1. Per-feed stats
  const { rows: feeds } = await db.query<{
    id: string;
    name: string;
    category: string;
    uuid: string;
    shadow: boolean;
    feed_published: boolean;
    total_matches: string;
    unique_authors: string;
    avg_per_day: string;
    first_match: Date | null;
    last_match: Date | null;
  }>(`
    SELECT
      t.id,
      t.name,
      COALESCE(t.category, 'uncategorized') as category,
      t.uuid,
      t.shadow,
      t.feed_published,
      COUNT(tm.id) AS total_matches,
      COUNT(DISTINCT tm.post_did) AS unique_authors,
      ROUND(COUNT(tm.id)::numeric / GREATEST(${days}, 1), 1) AS avg_per_day,
      MIN(tm.matched_at) AS first_match,
      MAX(tm.matched_at) AS last_match
    FROM tracks t
    LEFT JOIN track_matches tm
      ON tm.track_id = t.id
      AND tm.matched_at > NOW() - INTERVAL '${days} days'
    WHERE t.shadow = true OR (t.is_active = true AND t.feed_published = false)
    GROUP BY t.id, t.name, t.category, t.uuid, t.shadow, t.feed_published
    ORDER BY COUNT(tm.id) DESC
  `);

  if (feeds.length === 0) {
    console.log('\nNo shadow tracks found. Run createResearchFeeds.ts first.\n');
    process.exit(0);
  }

  // Viability tiers
  function tier(avgPerDay: number): string {
    if (avgPerDay >= 10) return '🟢';
    if (avgPerDay >= 3) return '🟡';
    if (avgPerDay > 0) return '🔴';
    return '⚫';
  }

  console.log(`\n📊 Shadow Feed Viability Report (last ${days} days)\n`);
  console.log(
    '  ' +
    'Tier'.padEnd(5) +
    'Feed Name'.padEnd(35) +
    'Category'.padEnd(15) +
    'Matches'.padStart(9) +
    'Authors'.padStart(9) +
    'Avg/Day'.padStart(9) +
    '  Status'
  );
  console.log('  ' + '-'.repeat(95));

  let greenCount = 0;
  let yellowCount = 0;
  let redCount = 0;
  let deadCount = 0;

  for (const f of feeds) {
    const avg = parseFloat(f.avg_per_day);
    const t = tier(avg);
    const status = f.feed_published ? 'published' : f.shadow ? 'shadow' : 'inactive';

    if (t === '🟢') greenCount++;
    else if (t === '🟡') yellowCount++;
    else if (t === '🔴') redCount++;
    else deadCount++;

    console.log(
      '  ' +
      t.padEnd(5) +
      (f.name || 'Untitled').substring(0, 33).padEnd(35) +
      (f.category || '').substring(0, 13).padEnd(15) +
      f.total_matches.padStart(9) +
      f.unique_authors.padStart(9) +
      f.avg_per_day.padStart(9) +
      `  ${status}`
    );
  }

  console.log('  ' + '-'.repeat(95));
  console.log(`\n  Viability Summary:`);
  console.log(`    🟢 Publish-ready (≥10/day):  ${greenCount}`);
  console.log(`    🟡 Monitor (3-9/day):        ${yellowCount}`);
  console.log(`    🔴 Low activity (<3/day):     ${redCount}`);
  console.log(`    ⚫ No matches:                ${deadCount}`);
  console.log(`    Total shadow feeds:           ${feeds.length}`);

  // 2. Category aggregates
  const catStats = new Map<string, { matches: number; feeds: number; green: number }>();
  for (const f of feeds) {
    const cat = f.category || 'uncategorized';
    const s = catStats.get(cat) || { matches: 0, feeds: 0, green: 0 };
    s.matches += parseInt(f.total_matches);
    s.feeds += 1;
    if (parseFloat(f.avg_per_day) >= 10) s.green += 1;
    catStats.set(cat, s);
  }

  console.log(`\n  Category Breakdown:`);
  console.log('    ' + 'Category'.padEnd(20) + 'Feeds'.padStart(7) + 'Matches'.padStart(10) + 'Viable'.padStart(8));
  console.log('    ' + '-'.repeat(45));
  const sortedCats = [...catStats.entries()].sort((a, b) => b[1].matches - a[1].matches);
  for (const [cat, s] of sortedCats) {
    console.log(
      '    ' +
      cat.padEnd(20) +
      String(s.feeds).padStart(7) +
      String(s.matches).padStart(10) +
      String(s.green).padStart(8)
    );
  }

  console.log();
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

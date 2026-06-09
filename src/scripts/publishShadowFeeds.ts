/**
 * publishShadowFeeds.ts — Bulk-publish viable shadow feeds as Bluesky custom feeds.
 *
 * Reads all shadow tracks with avg matches >= threshold, then creates
 * app.bsky.feed.generator records on the PDS for each.
 *
 * Usage:
 *   node --env-file=.env --import tsx/esm src/scripts/publishShadowFeeds.ts [--dry-run] [--min-avg 10] [--category broad,niche,geographic]
 *
 * Options:
 *   --dry-run           Show what would be published without doing it
 *   --min-avg <N>       Minimum avg matches/day over last 3 days (default: 10)
 *   --category <list>   Comma-separated categories to include (default: all)
 *   --limit <N>         Max feeds to publish in one run (default: all)
 */

import { db } from '../db/client.js';
import { updateTrack } from '../db/queries/tracks.js';
import { AtpAgent } from '@atproto/api';
import { logger } from '../lib/logger.js';

const DAYS = 3; // viability window
const SERVICE_DID = process.env.FEEDS_DID ?? 'did:web:feeds.social';

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const minAvgIdx = args.indexOf('--min-avg');
const MIN_AVG = minAvgIdx !== -1 ? parseFloat(args[minAvgIdx + 1]) : 10;
const catIdx = args.indexOf('--category');
const CATEGORIES = catIdx !== -1 ? args[catIdx + 1].split(',').map(s => s.trim()) : null;
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : Infinity;

function descriptionForFeed(name: string, category: string): string {
  if (category === 'geographic') {
    const city = name.replace(/ News$/, '');
    return `Local news, events, and community discussions about ${city}. Curated by track.social.`;
  }
  if (category === 'broad') {
    return `The latest ${name.toLowerCase()} posts, discussions, and news on Bluesky. Curated by track.social.`;
  }
  return `${name} — posts, discussions, and community content. Curated by track.social.`;
}

async function main() {
  // 1. Find all publishable shadow feeds
  const { rows: feeds } = await db.query<{
    id: string;
    name: string;
    category: string;
    uuid: string;
    shadow: boolean;
    feed_published: boolean;
    avg_per_day: string;
    total_matches: string;
    unique_authors: string;
  }>(`
    SELECT
      t.id, t.name,
      COALESCE(t.category, 'uncategorized') as category,
      t.uuid, t.shadow, t.feed_published,
      COUNT(tm.id) AS total_matches,
      COUNT(DISTINCT tm.post_did) AS unique_authors,
      ROUND(COUNT(tm.id)::numeric / GREATEST(${DAYS}, 1), 1) AS avg_per_day
    FROM tracks t
    LEFT JOIN track_matches tm
      ON tm.track_id = t.id
      AND tm.matched_at > NOW() - INTERVAL '${DAYS} days'
    WHERE (t.shadow = true OR t.is_active = true)
      AND t.feed_published = false
    GROUP BY t.id, t.name, t.category, t.uuid, t.shadow, t.feed_published
    HAVING ROUND(COUNT(tm.id)::numeric / GREATEST(${DAYS}, 1), 1) >= ${MIN_AVG}
    ORDER BY COUNT(tm.id) DESC
  `);

  // Filter by category if specified
  const filtered = CATEGORIES
    ? feeds.filter(f => CATEGORIES.includes(f.category))
    : feeds;

  const toPublish = filtered.slice(0, LIMIT);

  console.log(`\n📡 Shadow Feed Publisher\n`);
  console.log(`   Viable feeds found: ${feeds.length}`);
  console.log(`   After category filter: ${filtered.length}`);
  console.log(`   Will publish: ${toPublish.length}`);
  console.log(`   Min avg/day: ${MIN_AVG}`);
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  if (toPublish.length === 0) {
    console.log('   Nothing to publish.\n');
    process.exit(0);
  }

  // Show preview
  console.log('   Feeds to publish:');
  console.log('   ' + 'Name'.padEnd(35) + 'Category'.padEnd(15) + 'Avg/Day'.padStart(9) + '  Authors');
  console.log('   ' + '-'.repeat(70));
  for (const f of toPublish) {
    console.log(
      '   ' +
      f.name.substring(0, 33).padEnd(35) +
      f.category.padEnd(15) +
      f.avg_per_day.padStart(9) +
      f.unique_authors.padStart(9)
    );
  }
  console.log();

  if (DRY_RUN) {
    console.log(`✅ Dry run complete. ${toPublish.length} feeds would be published.\n`);
    process.exit(0);
  }

  // 2. Authenticate
  const handle = process.env.FEEDS_BSKY_HANDLE;
  const password = process.env.FEEDS_BSKY_PASSWORD;
  if (!handle || !password) {
    console.error('  ❌ FEEDS_BSKY_HANDLE and FEEDS_BSKY_PASSWORD required');
    process.exit(1);
  }

  const agent = new AtpAgent({ service: 'https://bsky.social' });
  await agent.login({ identifier: handle, password });
  const repoDid = agent.session!.did;
  console.log(`   Authenticated as: ${handle} (${repoDid})\n`);

  // 3. Publish each feed
  let published = 0;
  let errors = 0;

  for (const f of toPublish) {
    const description = descriptionForFeed(f.name, f.category);

    try {
      await agent.com.atproto.repo.putRecord({
        repo: repoDid,
        collection: 'app.bsky.feed.generator',
        rkey: f.uuid,
        record: {
          did: SERVICE_DID,
          displayName: f.name,
          description,
          createdAt: new Date().toISOString(),
        }
      });

      await updateTrack(BigInt(f.id), { feed_published: true });
      console.log(`  ✅ ${f.name} (${f.avg_per_day}/day, ${f.unique_authors} authors)`);
      published++;

      // Rate limit: 200ms between PDS writes
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      logger.error({ err, name: f.name, uuid: f.uuid }, 'Failed to publish feed');
      console.log(`  ❌ ${f.name} — ${(err as Error).message}`);
      errors++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Published: ${published}`);
  console.log(`   Errors: ${errors}`);
  console.log();

  await db.end();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

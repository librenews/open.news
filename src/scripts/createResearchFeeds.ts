/**
 * createResearchFeeds.ts — Batch-create research/shadow tracks from the catalog.
 *
 * These tracks are created as active (so they receive matches from the worker)
 * but NOT published as Bluesky feeds. The shadow stats can be queried to
 * determine viability before publishing.
 *
 * Usage:
 *   npx tsx src/scripts/createResearchFeeds.ts [--dry-run] [--publish-viable]
 *
 * --dry-run          Print catalog without creating anything
 * --publish-viable   Also publish feeds that meet the viability threshold
 */

import { RESEARCH_FEEDS } from '../data/researchFeeds.js';
import { db } from '../db/client.js';
import { createTrack, getTracksByUserId, updateTrack } from '../db/queries/tracks.js';
import { upsertTrackQuery } from '../track/opensearch.js';
import { updateTrackKeywords, updateTrackQueryEmbedding } from '../db/queries/tracks.js';
import { embedText } from '../track/embedClient.js';
import { logger } from '../lib/logger.js';

const SYSTEM_DID = 'did:web:track.social';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

async function getOrCreateSystemUser(): Promise<bigint> {
  const { rows: existing } = await db.query<{ id: bigint }>(
    `SELECT id FROM track_users WHERE did = $1`, [SYSTEM_DID]
  );
  if (existing.length > 0) return existing[0].id;

  const { rows: created } = await db.query<{ id: bigint }>(
    `INSERT INTO track_users (did, handle) VALUES ($1, $2) RETURNING id`,
    [SYSTEM_DID, 'track.social']
  );
  return created[0].id;
}

async function main() {
  // Deduplicate against existing system feeds
  const existingSystemFeeds = await import('../data/systemFeeds.js');
  const existingNames = new Set(existingSystemFeeds.SYSTEM_FEEDS.map(f => f.name));
  const newFeeds = RESEARCH_FEEDS.filter(f => !existingNames.has(f.name));

  console.log(`\n🔬 Research Feed Creator`);
  console.log(`   Total catalog: ${RESEARCH_FEEDS.length}`);
  console.log(`   Already in system feeds: ${RESEARCH_FEEDS.length - newFeeds.length}`);
  console.log(`   New feeds to create: ${newFeeds.length}`);
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  // Category breakdown
  const categories = new Map<string, number>();
  for (const f of newFeeds) {
    categories.set(f.category, (categories.get(f.category) || 0) + 1);
  }
  console.log('   Category breakdown:');
  for (const [cat, count] of categories) {
    console.log(`     ${cat}: ${count}`);
  }
  console.log();

  if (DRY_RUN) {
    for (const def of newFeeds) {
      console.log(`  [${def.category}] ${def.name}`);
      console.log(`    Query: ${def.query.substring(0, 80)}...`);
      console.log(`    Keywords (${def.keywords.length}): ${def.keywords.slice(0, 5).join(', ')}${def.keywords.length > 5 ? '...' : ''}`);
      console.log(`    Threshold: ${def.threshold}`);
      console.log();
    }
    console.log(`\n✅ Dry run complete. ${newFeeds.length} feeds would be created.`);
    process.exit(0);
  }

  const systemUserId = await getOrCreateSystemUser();
  console.log(`   System user ID: ${systemUserId}\n`);

  // Check for existing tracks to avoid duplicates
  const existingTracks = await getTracksByUserId(systemUserId);
  const existingTrackNames = new Set(existingTracks.map(t => t.name));

  let created = 0;
  let skipped = 0;
  let errors = 0;
  let embedFailures = 0;

  for (const def of newFeeds) {
    if (existingTrackNames.has(def.name)) {
      console.log(`  ⏭  [${def.category}] ${def.name} — already exists`);
      skipped++;
      continue;
    }

    try {
      // 1. Create the track (active but not published = shadow mode)
      const osQueryId = await upsertTrackQuery(0, def.keywords);
      const track = await createTrack(systemUserId, def.name, def.keywords, osQueryId, def.query, def.threshold);

      // 2. Re-register OpenSearch query with real track ID
      const realOsQueryId = await upsertTrackQuery(Number(track.id), def.keywords);
      await updateTrackKeywords(track.id, def.keywords, realOsQueryId);

      // 3. Mark as shadow + set category
      await db.query(
        `UPDATE tracks SET shadow = true, category = $2 WHERE id = $1`,
        [track.id, def.category]
      );

      // 4. Embed the semantic query
      try {
        const embedding = await embedText(def.query);
        await updateTrackQueryEmbedding(track.id, embedding);
      } catch (err) {
        logger.warn({ err, name: def.name }, 'Failed to embed query');
        embedFailures++;
      }

      console.log(`  ✅ [${def.category}] ${def.name} (ID: ${track.id})`);
      created++;

      // Small delay to avoid overwhelming the embed service
      await new Promise(r => setTimeout(r, 150));

    } catch (err) {
      logger.error({ err, name: def.name }, 'Failed to create research feed');
      console.log(`  ❌ [${def.category}] ${def.name} — ERROR: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped: ${skipped} (already existed)`);
  console.log(`   Embed failures: ${embedFailures} (tracks created, but no semantic matching)`);
  console.log(`   Errors: ${errors}`);
  console.log();

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

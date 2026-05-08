/**
 * createSystemFeeds.ts — Batch-create system tracks and publish them as Bluesky custom feeds.
 *
 * Usage:
 *   npx tsx src/scripts/createSystemFeeds.ts [--dry-run] [--publish]
 *
 * --dry-run   Print what would be created without touching the database
 * --publish   Also publish each feed to the track.social PDS as a Bluesky custom feed
 */

import { SYSTEM_FEEDS } from '../data/systemFeeds.js';
import { db } from '../db/client.js';
import { createTrack, getTracksByUserId, updateTrack } from '../db/queries/tracks.js';
import { upsertTrackQuery } from '../track/opensearch.js';
import { updateTrackKeywords, updateTrackQueryEmbedding } from '../db/queries/tracks.js';
import { embedText } from '../track/embedClient.js';
import { AtpAgent } from '@atproto/api';
import { logger } from '../lib/logger.js';

const SYSTEM_DID = 'did:web:track.social';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const PUBLISH = args.includes('--publish');

async function getOrCreateSystemUser(): Promise<bigint> {
  // System feeds use track_users table (same as regular track.social users)
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
  console.log(`\n🔧 System Feed Creator`);
  console.log(`   Feeds to process: ${SYSTEM_FEEDS.length}`);
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Publish to PDS: ${PUBLISH ? 'YES' : 'NO'}\n`);

  if (DRY_RUN) {
    for (const def of SYSTEM_FEEDS) {
      console.log(`  [${def.category}] ${def.name}`);
      console.log(`    Query: ${def.query}`);
      console.log(`    Keywords (${def.keywords.length}): ${def.keywords.join(', ')}`);
      console.log(`    Threshold: ${def.threshold}`);
      console.log();
    }
    console.log(`\n✅ Dry run complete. ${SYSTEM_FEEDS.length} feeds would be created.`);
    process.exit(0);
  }

  const systemUserId = await getOrCreateSystemUser();
  console.log(`   System user ID: ${systemUserId}\n`);

  // Check for existing system tracks to avoid duplicates
  const existingTracks = await getTracksByUserId(systemUserId);
  const existingNames = new Set(existingTracks.map(t => t.name));

  let created = 0;
  let skipped = 0;
  let published = 0;
  let errors = 0;

  // Authenticate with Bluesky using app password for publishing
  let agent: AtpAgent | null = null;
  let repoDid: string = '';
  if (PUBLISH) {
    const handle = process.env.TRACK_BSKY_HANDLE;
    const password = process.env.TRACK_BSKY_PASSWORD;
    if (!handle || !password) {
      console.error('  ❌ TRACK_BSKY_HANDLE and TRACK_BSKY_PASSWORD required for --publish');
      process.exit(1);
    }
    agent = new AtpAgent({ service: 'https://bsky.social' });
    await agent.login({ identifier: handle, password });
    repoDid = agent.session!.did;
    console.log(`   Authenticated as: ${handle} (${repoDid})\n`);
  }

  for (const def of SYSTEM_FEEDS) {
    if (existingNames.has(def.name)) {
      // If --publish, check if this existing track needs publishing
      if (PUBLISH) {
        const existing = existingTracks.find(t => t.name === def.name);
        if (existing && !existing.feed_published) {
          try {
            await agent!.com.atproto.repo.putRecord({
              repo: repoDid,
              collection: 'app.bsky.feed.generator',
              rkey: existing.uuid,
              record: {
                did: 'did:web:track.social',
                displayName: def.name,
                description: def.description,
                createdAt: new Date().toISOString(),
              }
            });

            await updateTrack(existing.id, { feed_published: true });
            console.log(`  📡 [${def.category}] ${def.name} — published existing track`);
            published++;
            await new Promise(r => setTimeout(r, 200));
          } catch (err) {
            logger.error({ err, name: def.name }, 'Failed to publish existing feed to PDS');
            console.log(`  ⚠️  [${def.category}] ${def.name} — failed to publish`);
            errors++;
          }
          continue;
        }
      }
      console.log(`  ⏭  [${def.category}] ${def.name} — already exists, skipping`);
      skipped++;
      continue;
    }

    try {
      // 1. Create the track
      const osQueryId = await upsertTrackQuery(0, def.keywords); // temp ID, will update
      const track = await createTrack(systemUserId, def.name, def.keywords, osQueryId, def.query, def.threshold);

      // 2. Re-register OpenSearch query with real track ID
      const realOsQueryId = await upsertTrackQuery(Number(track.id), def.keywords);
      await updateTrackKeywords(track.id, def.keywords, realOsQueryId);

      // 3. Embed the semantic query
      try {
        const embedding = await embedText(def.query);
        await updateTrackQueryEmbedding(track.id, embedding);
      } catch (err) {
        logger.warn({ err, name: def.name }, 'Failed to embed query — track created without semantic matching');
      }

      console.log(`  ✅ [${def.category}] ${def.name} — created (ID: ${track.id}, UUID: ${track.uuid})`);
      created++;

      // 4. Optionally publish to PDS
      if (PUBLISH) {
        try {
          await agent!.com.atproto.repo.putRecord({
            repo: repoDid,
            collection: 'app.bsky.feed.generator',
            rkey: track.uuid,
            record: {
              did: 'did:web:track.social',
              displayName: def.name,
              description: def.description,
              createdAt: new Date().toISOString(),
            }
          });

          await updateTrack(track.id, { feed_published: true });
          console.log(`  📡 Published to PDS: ${def.name}`);
          published++;
        } catch (err) {
          logger.error({ err, name: def.name }, 'Failed to publish feed to PDS');
          console.log(`  ⚠️  Failed to publish: ${def.name}`);
        }
      }

      // Small delay between creates to avoid overwhelming services
      await new Promise(r => setTimeout(r, 200));

    } catch (err) {
      logger.error({ err, name: def.name }, 'Failed to create system feed');
      console.log(`  ❌ [${def.category}] ${def.name} — ERROR: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped: ${skipped} (already existed)`);
  console.log(`   Published: ${published}`);
  console.log(`   Errors: ${errors}`);
  console.log();

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

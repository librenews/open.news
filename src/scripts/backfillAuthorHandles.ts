/**
 * Backfill author_handle for all existing site_standard_articles rows.
 * Processes in batches of 100, rate-limited to avoid hammering the profile API.
 *
 * Run once: npx tsx src/scripts/backfillAuthorHandles.ts
 */
import { db } from '../db/client.js';
import { getCachedProfile } from '../lib/pdsCache.js';
import { logger } from '../lib/logger.js';

const BATCH_SIZE = 100;
const DELAY_MS = 50; // small delay between batches to be gentle on cache/PDS

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  // Get all distinct DIDs that are missing a handle
  const { rows: didRows } = await db.query(`
    SELECT DISTINCT author_did
    FROM site_standard_articles
    WHERE author_handle IS NULL
    ORDER BY author_did
  `);

  const dids = didRows.map((r: any) => r.author_did);
  logger.info({ total: dids.length }, 'Starting author handle backfill');
  console.log(`Backfilling handles for ${dids.length} unique DIDs...`);

  let resolved = 0;
  let failed = 0;

  for (let i = 0; i < dids.length; i += BATCH_SIZE) {
    const batch = dids.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (did: string) => {
      try {
        const profile = await getCachedProfile(did);
        const handle = profile.handle || null;
        if (handle) {
          await db.query(
            'UPDATE site_standard_articles SET author_handle = $1 WHERE author_did = $2 AND author_handle IS NULL',
            [handle, did]
          );
          resolved++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }));

    const pct = (((i + batch.length) / dids.length) * 100).toFixed(1);
    console.log(`Progress: ${i + batch.length}/${dids.length} DIDs (${pct}%) — resolved: ${resolved}, failed: ${failed}`);

    if (i + BATCH_SIZE < dids.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nDone. Resolved: ${resolved}, Failed/empty: ${failed}`);

  // Report BridgyFed count
  const { rows: bfRows } = await db.query(`
    SELECT COUNT(DISTINCT author_did) AS cnt
    FROM site_standard_articles
    WHERE author_handle LIKE '%.web.brid.gy'
  `);
  console.log(`BridgyFed authors detected: ${bfRows[0].cnt}`);

  await db.end?.();
  process.exit(0);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

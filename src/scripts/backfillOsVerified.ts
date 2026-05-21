/**
 * Backfill the 'verified' boolean field in OpenSearch for existing documents.
 * Reads verified status from Postgres and updates OS docs.
 *
 * Usage: npx tsx src/scripts/backfillOsVerified.ts
 */
import { db } from '../db/client.js';
import { getOsClient, SITE_STANDARD_INDEX } from '../track/opensearch.js';

async function main() {
  const os = getOsClient();

  // Get all verified URIs from Postgres
  const res = await db.query(
    `SELECT uri, verified FROM site_standard_articles WHERE verified IS NOT NULL`
  );

  console.log(`Found ${res.rows.length} articles with verified status`);

  const BATCH_SIZE = 500;
  let updated = 0;

  for (let i = 0; i < res.rows.length; i += BATCH_SIZE) {
    const batch = res.rows.slice(i, i + BATCH_SIZE);
    const bulkBody: any[] = [];

    for (const row of batch) {
      bulkBody.push({ update: { _index: SITE_STANDARD_INDEX, _id: row.uri } });
      bulkBody.push({ doc: { verified: row.verified === true } });
    }

    if (bulkBody.length > 0) {
      const result = await os.bulk({ body: bulkBody });
      const errors = result.body.items?.filter((item: any) => item.update?.error);
      if (errors?.length) {
        console.warn(`  Batch ${i / BATCH_SIZE + 1}: ${errors.length} errors`);
      }
      updated += batch.length;
      console.log(`  Updated ${updated}/${res.rows.length}`);
    }
  }

  console.log(`Done — updated ${updated} documents in OpenSearch`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

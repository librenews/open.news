import { enqueueJob } from '../web/jobEnqueue.js';
import { markSiteStandardDidKnown } from '../db/queries/siteStandard.js';

async function main() {
  const did = process.argv[2];
  if (!did) {
    console.error('Usage: npx tsx src/scripts/forceBackfill.ts <did>');
    process.exit(1);
  }

  console.log(`Enqueuing backfill for ${did}...`);
  
  // Mark as known so we don't trigger it redundantly in the future
  await markSiteStandardDidKnown(did);
  
  // Enqueue the backfill job
  await enqueueJob('backfillSiteStandard', { did });
  
  console.log('Backfill job successfully enqueued! The worker will pick it up momentarily.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

import { db } from '../db/client.js';
import { getOsClient, SITE_STANDARD_INDEX } from '../track/opensearch.js';
import { logger } from '../lib/logger.js';

async function run() {
  logger.info('Starting bskyPostRef backfill to OpenSearch...');
  const os = getOsClient();
  
  // Find all articles in Postgres that have a bskyPostRef.uri
  const res = await db.query(`
    SELECT uri, raw_record->'bskyPostRef'->>'uri' as bsky_post_uri 
    FROM site_standard_articles 
    WHERE raw_record->'bskyPostRef'->>'uri' IS NOT NULL
  `);
  
  logger.info(`Found ${res.rowCount} records with bskyPostRef to update in OpenSearch`);
  
  let successCount = 0;
  let batch: any[] = [];
  
  for (const row of res.rows) {
    batch.push({ update: { _index: SITE_STANDARD_INDEX, _id: row.uri } });
    batch.push({ doc: { bsky_post_uri: row.bsky_post_uri } });
    
    if (batch.length >= 2000) { // 1000 operations (each operation is 2 elements in the array)
      try {
        const bulkRes = await os.bulk({ body: batch });
        if (bulkRes.body?.errors) {
          logger.error('Bulk update had errors');
        } else {
          successCount += batch.length / 2;
          logger.info(`Updated ${successCount} records...`);
        }
      } catch (err) {
        logger.error({ err }, 'Bulk update threw an exception');
      }
      batch = [];
    }
  }
  
  // Flush remaining
  if (batch.length > 0) {
    try {
      const bulkRes = await os.bulk({ body: batch });
      if (bulkRes.body?.errors) {
        logger.error('Bulk update had errors');
      } else {
        successCount += batch.length / 2;
        logger.info(`Updated ${successCount} records...`);
      }
    } catch (err) {
      logger.error({ err }, 'Bulk update threw an exception');
    }
  }
  
  logger.info(`Finished backfilling OpenSearch. Total successfully queued/updated: ${successCount}`);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

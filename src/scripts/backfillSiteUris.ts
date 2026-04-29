import { db } from '../db/client.js';
import { getOsClient, SITE_STANDARD_INDEX } from '../track/opensearch.js';
import { resolvePds } from '../lib/pds.js';
import { BskyAgent } from '@atproto/api';
import { logger } from '../lib/logger.js';

async function run() {
  logger.info('Starting backfill for AT URI site fields...');
  const os = getOsClient();
  
  // Find all articles in Postgres where site is an AT URI
  const res = await db.query(`
    SELECT uri, site 
    FROM site_standard_articles 
    WHERE site LIKE 'at://%' AND site LIKE '%site.standard.publication%'
  `);
  
  logger.info(`Found ${res.rowCount} records with an AT URI site to resolve...`);
  
  let successCount = 0;
  
  for (const row of res.rows) {
    let newSiteUrl = null;
    try {
      // Check cache first
      const cacheRes = await db.query('SELECT url FROM site_publications WHERE uri = $1', [row.site]);
      if (cacheRes.rowCount !== null && cacheRes.rowCount > 0) {
        newSiteUrl = cacheRes.rows[0].url;
      } else {
        // Fetch from PDS
        const [siteDid, , rkey] = row.site.replace('at://', '').split('/');
        const pdsEndpoint = await resolvePds(siteDid);
        const agent = new BskyAgent({ service: pdsEndpoint });
        const pdsRes = await agent.com.atproto.repo.getRecord({
          repo: siteDid,
          collection: 'site.standard.publication',
          rkey
        });
        const pubUrl = pdsRes.data.value.url;
        
        if (pubUrl && typeof pubUrl === 'string') {
          newSiteUrl = pubUrl;
          // Save to cache
          await db.query(
            'INSERT INTO site_publications (uri, url, raw_record) VALUES ($1, $2, $3) ON CONFLICT (uri) DO NOTHING',
            [row.site, pubUrl, pdsRes.data.value]
          );
        }
      }
      
      // If we successfully resolved an HTTP URL, update OpenSearch and Postgres
      if (newSiteUrl && newSiteUrl.startsWith('http')) {
        await db.query('UPDATE site_standard_articles SET site = $1 WHERE uri = $2', [newSiteUrl, row.uri]);
        await os.update({
          index: SITE_STANDARD_INDEX,
          id: row.uri,
          body: { doc: { site: newSiteUrl } }
        });
        successCount++;
        logger.info(`Resolved ${row.site} -> ${newSiteUrl}`);
      }
    } catch (err: any) {
      logger.warn({ err: err.message, site: row.site }, 'Failed to resolve site AT URI during backfill');
    }
  }
  
  logger.info(`Finished backfilling AT URIs. Successfully healed ${successCount} records.`);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

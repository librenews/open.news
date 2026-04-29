import { Job } from 'pg-boss';
import { BskyAgent } from '@atproto/api';
import { logger } from '../lib/logger.js';
import { enqueueJob } from '../web/jobEnqueue.js';
import { resolvePds } from '../lib/pds.js';

interface BackfillSiteStandardData {
  did: string;
}

export async function backfillSiteStandardJob(job: Job<BackfillSiteStandardData>) {
  const { did } = job.data;
  
  try {
    const pdsEndpoint = await resolvePds(did);
    
    logger.info({ did, pdsEndpoint }, 'Resolved PDS endpoint for backfill');

    // 2. Query the actual PDS instead of the central AppView
    const agent = new BskyAgent({ service: pdsEndpoint });
    
    let cursor: string | undefined = undefined;
    let totalFound = 0;
    
    const collections = ['site.standard.document', 'com.whtwnd.blog.entry', 'pub.leaflet.document'];
    
    for (const coll of collections) {
      let cursor: string | undefined = undefined;
      try {
        do {
          const res = await agent.com.atproto.repo.listRecords({
            repo: did,
            collection: coll,
            cursor: cursor,
            limit: 50
          });
          
          for (const record of res.data.records) {
            // Enqueue an index job for each document
            await enqueueJob('indexSiteStandard', {
              postUri: record.uri,
              did: did,
              record: record.value
            });
            totalFound++;
          }
          
          cursor = res.data.cursor;
        } while (cursor);
      } catch (err: any) {
        logger.warn({ err: err.message, did, collection: coll }, 'Failed or unsupported collection during backfill, skipping');
      }
    }
    
    logger.info({ did, totalFound }, 'Finished backfilling longform records for author');
  } catch (err) {
    logger.error({ err, did }, 'Failed to backfill site.standard.document records');
    throw err;
  }
}

import { Job } from 'pg-boss';
import { BskyAgent } from '@atproto/api';
import { logger } from '../lib/logger.js';
import { enqueueJob } from '../web/jobEnqueue.js';

interface BackfillSiteStandardData {
  did: string;
}

export async function backfillSiteStandardJob(job: Job<BackfillSiteStandardData>) {
  const { did } = job.data;
  
  try {
    // We can use the public AppView to fetch all records for a DID
    const agent = new BskyAgent({ service: 'https://public.api.bsky.app' });
    
    let cursor: string | undefined = undefined;
    let totalFound = 0;
    
    do {
      const res = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: 'site.standard.document',
        cursor: cursor,
        limit: 50
      });
      
      for (const record of res.data.records) {
        // Enqueue an index job for each document
        enqueueJob('indexSiteStandard', {
          postUri: record.uri,
          did: did,
          record: record.value
        });
        totalFound++;
      }
      
      cursor = res.data.cursor;
    } while (cursor);
    
    logger.info({ did, totalFound }, 'Finished backfilling site.standard.document records for author');
  } catch (err) {
    logger.error({ err, did }, 'Failed to backfill site.standard.document records');
    throw err;
  }
}

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
    let pdsEndpoint = 'https://public.api.bsky.app'; // Fallback
    
    // 1. Resolve DID to PDS endpoint
    if (did.startsWith('did:plc:')) {
      const plcRes = await fetch(`https://plc.directory/${did}`);
      if (plcRes.ok) {
        const plcDoc = await plcRes.json();
        const pdsService = plcDoc.service?.find((s: any) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
        if (pdsService && pdsService.serviceEndpoint) {
          pdsEndpoint = pdsService.serviceEndpoint;
        }
      }
    } else if (did.startsWith('did:web:')) {
      const domain = did.slice(8);
      const webRes = await fetch(`https://${domain}/.well-known/did.json`);
      if (webRes.ok) {
        const webDoc = await webRes.json();
        const pdsService = webDoc.service?.find((s: any) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
        if (pdsService && pdsService.serviceEndpoint) {
          pdsEndpoint = pdsService.serviceEndpoint;
        }
      }
    }
    
    logger.info({ did, pdsEndpoint }, 'Resolved PDS endpoint for backfill');

    // 2. Query the actual PDS instead of the central AppView
    const agent = new BskyAgent({ service: pdsEndpoint });
    
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

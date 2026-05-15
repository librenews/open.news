import { Job } from 'pg-boss';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { resolvePds } from '../lib/pds.js';
import { BskyAgent } from '@atproto/api';

const BATCH_SIZE = 50; // users per job run

interface BackfillRecommendsData {
  offset?: number;
}

/**
 * Backfill site.standard.graph.recommend records from known users' PDS repos.
 * This is the standard lexicon used by Leaflet and other AT Protocol apps
 * for "liking" longform documents.
 *
 * Scans each known user's site.standard.graph.recommend collection and
 * inserts matching interactions into article_interactions.
 */
export async function backfillRecommendsJob(job: Job<BackfillRecommendsData>) {
  const offset = job.data.offset || 0;

  // Fetch a batch of known users (anyone who has logged into longform)
  const { rows: users } = await db.query(
    `SELECT DISTINCT did FROM longform_users
     WHERE did IS NOT NULL
     ORDER BY did
     LIMIT $1 OFFSET $2`,
    [BATCH_SIZE, offset]
  );

  if (users.length === 0) {
    logger.info({ offset }, 'Recommends backfill complete — no more users');
    return;
  }

  let totalRecommends = 0;
  let errors = 0;

  for (const user of users) {
    const did = user.did;
    try {
      const pdsUrl = await resolvePds(did);
      const agent = new BskyAgent({ service: pdsUrl });

      let cursor: string | undefined;
      do {
        const res = await agent.com.atproto.repo.listRecords({
          repo: did,
          collection: 'site.standard.graph.recommend',
          cursor,
          limit: 100,
        });

        for (const record of res.data.records) {
          const value = record.value as { document?: string; subject?: string };
          const articleUri = value.document || value.subject;
          if (!articleUri || typeof articleUri !== 'string') continue;

          // Only track recommends on longform documents we index
          const longformPatterns = ['/site.standard.document/', '/pub.leaflet.document/'];
          if (!longformPatterns.some(p => articleUri.includes(p))) continue;

          await db.query(
            `INSERT INTO article_interactions (article_uri, actor_did, interaction_type, record_uri)
             VALUES ($1, $2, 'like', $3) ON CONFLICT (article_uri, actor_did, interaction_type) DO NOTHING`,
            [articleUri, did, record.uri]
          );
          totalRecommends++;
        }

        cursor = res.data.cursor;
      } while (cursor);
    } catch (err: any) {
      errors++;
      logger.debug({ err: err.message, did }, 'Failed to fetch recommends for user');
    }
  }

  logger.info(
    { offset, batch: users.length, totalRecommends, errors },
    'Recommends backfill batch complete'
  );

  // Self-enqueue next batch if we got a full batch
  if (users.length === BATCH_SIZE) {
    const { enqueueJob } = await import('../web/jobEnqueue.js');
    await enqueueJob('backfillRecommends', { offset: offset + BATCH_SIZE });
    logger.info({ nextOffset: offset + BATCH_SIZE }, 'Enqueued next recommends backfill batch');
  } else {
    logger.info('Recommends backfill fully complete');
  }
}

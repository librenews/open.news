import { Job } from 'pg-boss';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';

const PUBLIC_API = 'https://public.api.bsky.app';
const BATCH_SIZE = 100; // articles per job run
const RATE_DELAY_MS = 100; // gentle delay between API calls

interface BackfillInteractionsData {
  offset?: number;
}

/**
 * Backfill likes and reposts for all indexed longform articles
 * by querying the Bluesky public AppView (getLikes / getRepostedBy).
 *
 * Processes articles in batches and self-enqueues continuation jobs.
 */
export async function backfillInteractionsJob(job: Job<BackfillInteractionsData>) {
  const offset = job.data.offset || 0;

  // Fetch a batch of article URIs
  const { rows: articles } = await db.query(
    `SELECT uri FROM site_standard_articles
     ORDER BY published_at DESC NULLS LAST
     LIMIT $1 OFFSET $2`,
    [BATCH_SIZE, offset]
  );

  if (articles.length === 0) {
    logger.info({ offset }, 'Interactions backfill complete — no more articles');
    return;
  }

  let totalLikes = 0;
  let totalReposts = 0;
  let errors = 0;

  for (const article of articles) {
    const uri = article.uri;

    try {
      // Fetch likes
      let likesCursor: string | undefined;
      do {
        const params = new URLSearchParams({ uri, limit: '100' });
        if (likesCursor) params.set('cursor', likesCursor);

        const res = await fetch(`${PUBLIC_API}/xrpc/app.bsky.feed.getLikes?${params}`);
        if (!res.ok) {
          // Rate limited or error — skip this article
          if (res.status === 429) {
            logger.warn({ uri }, 'Rate limited on getLikes, pausing');
            await sleep(5000);
          }
          break;
        }

        const data = await res.json() as { likes: { actor: { did: string }; createdAt: string }[]; cursor?: string };
        for (const like of data.likes) {
          await db.query(
            `INSERT INTO article_interactions (article_uri, actor_did, interaction_type)
             VALUES ($1, $2, 'like') ON CONFLICT (article_uri, actor_did, interaction_type) DO NOTHING`,
            [uri, like.actor.did]
          );
          totalLikes++;
        }
        likesCursor = data.cursor;
      } while (likesCursor);

      await sleep(RATE_DELAY_MS);

      // Fetch reposts
      let repostsCursor: string | undefined;
      do {
        const params = new URLSearchParams({ uri, limit: '100' });
        if (repostsCursor) params.set('cursor', repostsCursor);

        const res = await fetch(`${PUBLIC_API}/xrpc/app.bsky.feed.getRepostedBy?${params}`);
        if (!res.ok) {
          if (res.status === 429) {
            logger.warn({ uri }, 'Rate limited on getRepostedBy, pausing');
            await sleep(5000);
          }
          break;
        }

        const data = await res.json() as { repostedBy: { did: string }[]; cursor?: string };
        for (const actor of data.repostedBy) {
          await db.query(
            `INSERT INTO article_interactions (article_uri, actor_did, interaction_type)
             VALUES ($1, $2, 'repost') ON CONFLICT (article_uri, actor_did, interaction_type) DO NOTHING`,
            [uri, actor.did]
          );
          totalReposts++;
        }
        repostsCursor = data.cursor;
      } while (repostsCursor);

      await sleep(RATE_DELAY_MS);
    } catch (err: any) {
      errors++;
      logger.debug({ err: err.message, uri }, 'Failed to fetch interactions for article');
    }
  }

  logger.info(
    { offset, batch: articles.length, totalLikes, totalReposts, errors },
    'Interactions backfill batch complete'
  );

  // Self-enqueue next batch if we got a full batch
  if (articles.length === BATCH_SIZE) {
    const { enqueueJob } = await import('../web/jobEnqueue.js');
    await enqueueJob('backfillInteractions', { offset: offset + BATCH_SIZE });
    logger.info({ nextOffset: offset + BATCH_SIZE }, 'Enqueued next interactions backfill batch');
  } else {
    logger.info('Interactions backfill fully complete');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

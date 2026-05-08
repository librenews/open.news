import PgBoss from 'pg-boss';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { fetchArticleJob } from '../jobs/fetchArticle.js';
import { syncFollowsJob } from '../jobs/syncFollows.js';
import { botReplyJob } from '../jobs/botReply.js';
import { botPostJob } from '../jobs/botPost.js';
import { deliverWebhookJob } from '../jobs/deliverWebhook.js';
import { ensureArticleIndex, ensureSiteStandardIndex } from '../track/opensearch.js';
import { indexSiteStandardJob } from '../jobs/indexSiteStandard.js';
import { backfillSiteStandardJob } from '../jobs/backfillSiteStandard.js';
import { refreshTopicClusters } from '../jobs/refreshTopicClusters.js';

async function start() {
  await ensureArticleIndex().catch(err => logger.error({ err }, 'Failed to ensure OpenSearch article index'));
  await ensureSiteStandardIndex().catch(err => logger.error({ err }, 'Failed to ensure OpenSearch site_standard_docs index'));

  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    retryLimit: 3,
    retryDelay: 30,
    deleteAfterDays: 7,
    monitorStateIntervalSeconds: 30,
  });

  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));

  await boss.start();
  logger.info('pg-boss worker started');

  // pg-boss v10 requires explicit queue creation before send/work.
  // Must be sequential — parallel ALTER TABLE calls deadlock on the FK constraint.
  const queues = ['fetchArticle', 'syncFollows', 'botReply', 'botPost', 'followSignup', 'deliverWebhook', 'indexSiteStandard', 'backfillSiteStandard', 'refreshTopicClusters'];
  for (const q of queues) await boss.createQueue(q);
  logger.info({ queues }, 'Queues created');

  await boss.work('fetchArticle', { batchSize: 5 }, async (jobs) => {
    for (const job of jobs) {
      await fetchArticleJob(job.data as Parameters<typeof fetchArticleJob>[0]);
    }
  });

  await boss.work('syncFollows', { batchSize: 2 }, async (jobs) => {
    for (const job of jobs) {
      await syncFollowsJob(job.data as Parameters<typeof syncFollowsJob>[0]);
    }
  });

  await boss.work('botReply', { batchSize: 3 }, async (jobs) => {
    for (const job of jobs) {
      await botReplyJob(job.data as Parameters<typeof botReplyJob>[0]);
    }
  });

  await boss.work('botPost', { batchSize: 2 }, async (jobs) => {
    for (const job of jobs) {
      await botPostJob(job.data as Parameters<typeof botPostJob>[0]);
    }
  });

  await boss.work('deliverWebhook', { batchSize: 20 }, async (jobs) => {
    for (const job of jobs) {
      await deliverWebhookJob(job.data as Parameters<typeof deliverWebhookJob>[0]);
    }
  });

  await boss.work('indexSiteStandard', { batchSize: 50 }, async (jobs) => {
    for (const job of jobs) {
      await indexSiteStandardJob(job as Parameters<typeof indexSiteStandardJob>[0]);
    }
  });

  await boss.work('backfillSiteStandard', { batchSize: 2 }, async (jobs) => {
    for (const job of jobs) {
      await backfillSiteStandardJob(job as Parameters<typeof backfillSiteStandardJob>[0]);
    }
  });

  // Follow-as-signup: partial user creation
  const { getUserByDid } = await import('../db/queries/users.js');
  const { upsertUser } = await import('../db/queries/users.js');
  await boss.work('followSignup', { batchSize: 2 }, async (jobs) => {
    for (const job of jobs) {
      const { followerDid } = job.data as { followerDid: string };
      const existing = await getUserByDid(followerDid);
      if (!existing) {
        await upsertUser({ did: followerDid, handle: followerDid });
        logger.info({ followerDid }, 'Follow-as-signup: partial user created');
      }
    }
  });

  logger.info('All workers registered');

  // Schedule hourly topic cluster refresh
  await boss.schedule('refreshTopicClusters', '0 * * * *', {}, { tz: 'UTC' });
  await boss.work('refreshTopicClusters', async () => {
    await refreshTopicClusters();
  });
  logger.info('Topic cluster refresh scheduled (hourly)');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, stopping pg-boss');
    await boss.stop();
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    logger.info('SIGINT received, stopping pg-boss');
    await boss.stop();
    process.exit(0);
  });
}

start().catch((err) => {
  logger.error({ err }, 'Worker startup failed');
  process.exit(1);
});

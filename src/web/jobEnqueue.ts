/**
 * Shared pg-boss job enqueue helper.
 * Imported lazily by routes to avoid circular deps with the worker.
 */
import PgBoss, { SendOptions } from 'pg-boss';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

let _boss: PgBoss | null = null;

async function getBoss(): Promise<PgBoss> {
  if (_boss) return _boss;
  _boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    retryLimit: 3,
    retryDelay: 30,
    deleteAfterDays: 7,
    monitorStateIntervalSeconds: 30,
  });
  await _boss.start();
  return _boss;
}

export async function enqueueJob(name: string, data: Record<string, unknown>, options?: SendOptions): Promise<void> {
  const boss = await getBoss();
  // pg-boss v10: queue must exist before send
  await boss.createQueue(name);
  const jobId = await boss.send(name, data, options);
  logger.info({ name, jobId }, 'Job enqueued');
}

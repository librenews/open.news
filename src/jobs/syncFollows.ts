import { getFollowedDids } from '../services/atproto.js';
import { upsertSource, linkUserSource } from '../db/queries/sources.js';
import { markFollowsSynced } from '../db/queries/users.js';
import { logger } from '../lib/logger.js';

export interface SyncFollowsJobData {
  userId: string;
  userDid: string;
}

export async function syncFollowsJob(data: SyncFollowsJobData): Promise<void> {
  const userId = BigInt(data.userId);
  logger.info({ userId, userDid: data.userDid }, 'Syncing follows');

  const follows = await getFollowedDids(data.userDid);
  logger.info({ count: follows.length, userId }, 'Follows fetched');

  for (const follow of follows) {
    const source = await upsertSource({
      type: 'bluesky',
      did: follow.did,
      handle: follow.handle,
      display_name: follow.displayName ?? null,
      avatar_url: follow.avatar ?? null,
    });
    await linkUserSource(userId, source.id);
  }

  await markFollowsSynced(userId);
  logger.info({ userId, count: follows.length }, 'Follow sync complete');
}

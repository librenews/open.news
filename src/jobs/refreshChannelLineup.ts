import { generateLineup, persistLineup } from '../channel/programmer.js';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';

export async function refreshChannelLineups(): Promise<void> {
  const { rows } = await db.query<{ slug: string }>('SELECT slug FROM channels WHERE is_active = true');
  for (const { slug } of rows) {
    try {
      const lineup = await generateLineup(slug);
      if (lineup) {
        await persistLineup(lineup);
        logger.info({ channel: slug, segments: lineup.segments.length, stories: lineup.storyCount }, 'Channel lineup refreshed');
      } else {
        logger.info({ channel: slug }, 'No content available for channel lineup');
      }
    } catch (err) {
      logger.error({ err, channel: slug }, 'Failed to refresh channel lineup');
    }
  }
}

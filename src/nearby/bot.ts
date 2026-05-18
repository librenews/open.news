import { BskyAgent } from '@atproto/api';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

let botAgent: BskyAgent | null = null;

export async function getNearbyBot(): Promise<BskyAgent | null> {
  if (botAgent) return botAgent;
  if (!config.NEARBY_BOT_DID || !config.NEARBY_BOT_PASSWORD) {
    return null;
  }

  const agent = new BskyAgent({ service: config.ATPROTO_PDS_URL });
  try {
    await agent.login({
      identifier: config.NEARBY_BOT_DID,
      password: config.NEARBY_BOT_PASSWORD
    });
    botAgent = agent;
    logger.info({ did: config.NEARBY_BOT_DID }, 'Nearby bot logged in');
    return agent;
  } catch (err) {
    logger.error({ err }, 'Failed to login Nearby bot');
    return null;
  }
}

/**
 * Returns the bot DID for use as the tagger_did in geotag records.
 */
export function getNearbyBotDid(): string {
  return config.NEARBY_BOT_DID || 'did:plc:nearby-bot';
}

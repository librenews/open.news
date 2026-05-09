import { BskyAgent, RichText } from '@atproto/api';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

let botAgent: BskyAgent | null = null;

export async function getLongformBot(): Promise<BskyAgent | null> {
  if (botAgent) return botAgent;
  if (!config.CENTIPEDIA_BOT_DID || !config.CENTIPEDIA_BOT_PASSWORD) {
    return null;
  }

  const agent = new BskyAgent({ service: config.ATPROTO_PDS_URL });
  try {
    await agent.login({
      identifier: config.CENTIPEDIA_BOT_DID,
      password: config.CENTIPEDIA_BOT_PASSWORD
    });
    botAgent = agent;
    logger.info({ did: config.CENTIPEDIA_BOT_DID }, 'Longform bot logged in');
    return agent;
  } catch (err) {
    logger.error({ err }, 'Failed to login Longform bot');
    return null;
  }
}

export async function announcePublication(authorHandle: string, title: string, uri: string) {
  try {
    const agent = await getLongformBot();
    if (!agent) {
      logger.debug('Longform bot not configured, skipping announcement');
      return;
    }

    // Extract the DID and RKEY from the URI
    // URI format: at://did:plc:xxx/pub.leaflet.document/rkey
    const parts = uri.split('/');
    if (parts.length < 5) return;
    const authorDid = parts[2];
    const rkey = parts[4];
    
    const postUrl = `https://${config.CENTIPEDIA_DOMAIN}/post/${authorDid}/${rkey}`;
    
    // Attempt to resolve the author's handle to tag them if possible, otherwise use handle as text
    const text = `📰 New article published on Longform by @${authorHandle}!\n\n"${title}"\n\nRead it here: ${postUrl}`;
    
    const rt = new RichText({ text });
    await rt.detectFacets(agent);

    await agent.post({
      text: rt.text,
      facets: rt.facets
    });
    
    logger.info({ authorDid, postUrl }, 'Longform bot announced publication');
  } catch (err) {
    logger.error({ err }, 'Failed to announce publication via Longform bot');
  }
}

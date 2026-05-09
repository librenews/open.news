import { BskyAgent, RichText } from '@atproto/api';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

let botAgent: BskyAgent | null = null;

/**
 * Get or create the Centipedia bot agent.
 * Uses CENTIPEDIA_BSKY_HANDLE + CENTIPEDIA_BSKY_PASSWORD for auth.
 */
export async function getCentipediaBot(): Promise<BskyAgent | null> {
  if (botAgent) return botAgent;
  if (!config.CENTIPEDIA_BSKY_HANDLE || !config.CENTIPEDIA_BSKY_PASSWORD) {
    return null;
  }

  const agent = new BskyAgent({ service: config.ATPROTO_PDS_URL });
  try {
    await agent.login({
      identifier: config.CENTIPEDIA_BSKY_HANDLE,
      password: config.CENTIPEDIA_BSKY_PASSWORD
    });
    botAgent = agent;
    logger.info({ handle: config.CENTIPEDIA_BSKY_HANDLE, did: agent.session?.did }, 'Centipedia bot logged in');
    return agent;
  } catch (err) {
    logger.error({ err }, 'Failed to login Centipedia bot');
    return null;
  }
}

/**
 * Ensure the Centipedia publication record exists in the bot's repo.
 * Creates it if missing. Returns the publication AT-URI.
 */
export async function ensurePublication(): Promise<string | null> {
  const agent = await getCentipediaBot();
  if (!agent || !agent.session) return null;

  const did = agent.session.did;
  const collection = 'site.standard.publication';
  const rkey = 'self'; // canonical rkey for the encyclopedia publication

  try {
    // Check if publication already exists
    const existing = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection,
      rkey,
    });
    const uri = existing.data.uri;
    logger.info({ uri }, 'Centipedia publication already exists');
    return uri;
  } catch (err: any) {
    // Record doesn't exist — create it
    if (err?.status === 400 || err?.message?.includes('not found') || err?.message?.includes('Could not locate')) {
      try {
        const res = await agent.com.atproto.repo.createRecord({
          repo: did,
          collection,
          rkey,
          record: {
            $type: 'site.standard.publication',
            title: 'Centipedia',
            description: 'The agentic encyclopedia — knowledge synthesized by AI agents from human-curated citations.',
            createdAt: new Date().toISOString(),
          },
        });
        logger.info({ uri: res.data.uri }, 'Created Centipedia publication record');
        return res.data.uri;
      } catch (createErr) {
        logger.error({ err: createErr }, 'Failed to create Centipedia publication record');
        return null;
      }
    }
    logger.error({ err }, 'Failed to check Centipedia publication');
    return null;
  }
}

/**
 * Announce an article update on Bluesky.
 */
export async function announceArticle(title: string, articleUrl: string) {
  try {
    const agent = await getCentipediaBot();
    if (!agent) {
      logger.debug('Centipedia bot not configured, skipping announcement');
      return;
    }

    const text = `📚 New Centipedia article: "${title}"\n\n${articleUrl}`;
    
    const rt = new RichText({ text });
    await rt.detectFacets(agent);

    await agent.post({
      text: rt.text,
      facets: rt.facets
    });
    
    logger.info({ title, articleUrl }, 'Centipedia bot announced article');
  } catch (err) {
    logger.error({ err }, 'Failed to announce article via Centipedia bot');
  }
}

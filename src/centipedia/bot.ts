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
 * Announce an article update on Bluesky with a rich link card.
 */
export async function announceArticle(title: string, articleUrl: string, isRegeneration = false) {
  try {
    const agent = await getCentipediaBot();
    if (!agent) {
      logger.debug('Centipedia bot not configured, skipping announcement');
      return;
    }

    const emoji = isRegeneration ? '🔄' : '📚';
    const verb = isRegeneration ? 'Updated' : 'New';
    const text = `${emoji} ${verb} Centipedia article: "${title}"\n\nSynthesized from community-curated citations with trust-weighted verification.\n\n${articleUrl}`;
    
    const rt = new RichText({ text });
    await rt.detectFacets(agent);

    // Build external embed for rich card
    const embed: any = {
      $type: 'app.bsky.embed.external',
      external: {
        uri: articleUrl,
        title: `${title} — Centipedia`,
        description: `${verb} encyclopedia article about ${title}, built from community-curated citations.`,
      },
    };

    // Try to fetch OG image for the card
    try {
      const ogRes = await fetch(articleUrl, {
        headers: { 'User-Agent': 'Centipedia/1.0' },
        redirect: 'follow',
      });
      if (ogRes.ok) {
        const html = await ogRes.text();
        const ogImageMatch = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i)
          || html.match(/<meta\s+content="([^"]+)"\s+(?:property|name)="og:image"/i);
        if (ogImageMatch?.[1]) {
          const imgUrl = ogImageMatch[1].startsWith('http') ? ogImageMatch[1] : `https://${new URL(articleUrl).host}${ogImageMatch[1]}`;
          const imgRes = await fetch(imgUrl);
          if (imgRes.ok) {
            const imgBuf = await imgRes.arrayBuffer();
            const blob = await agent.uploadBlob(new Uint8Array(imgBuf), { encoding: imgRes.headers.get('content-type') || 'image/jpeg' });
            embed.external.thumb = blob.data.blob;
          }
        }
      }
    } catch (imgErr) {
      // Non-fatal — post without thumb
      logger.debug({ err: imgErr }, 'Could not fetch OG image for card');
    }

    await agent.post({
      text: rt.text,
      facets: rt.facets,
      embed,
    });
    
    logger.info({ title, articleUrl, isRegeneration }, 'Centipedia bot announced article');
  } catch (err) {
    logger.error({ err }, 'Failed to announce article via Centipedia bot');
  }
}

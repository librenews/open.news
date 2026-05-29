import { BskyAgent, RichText } from '@atproto/api';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

let botAgent: BskyAgent | null = null;

export async function getLongformBot(): Promise<BskyAgent | null> {
  if (botAgent) return botAgent;
  if (!config.LONGFORM_BOT_DID || !config.LONGFORM_BOT_PASSWORD) {
    return null;
  }

  const agent = new BskyAgent({ service: config.ATPROTO_PDS_URL });
  try {
    await agent.login({
      identifier: config.LONGFORM_BOT_DID,
      password: config.LONGFORM_BOT_PASSWORD
    });
    botAgent = agent;
    logger.info({ did: config.LONGFORM_BOT_DID }, 'Longform bot logged in');
    return agent;
  } catch (err) {
    logger.error({ err }, 'Failed to login Longform bot');
    return null;
  }
}

export interface AnnouncementContext {
  authorHandle: string;
  title: string;
  uri: string;          // at:// URI of the document
  docCid: string;       // CID of the document record
  publicationUri?: string;  // at:// URI of the publication (e.g. at://did/site.standard.publication/self)
  publicationCid?: string;  // CID of the publication record
  excerpt?: string;     // First ~160 chars of the article for the embed description
}

export async function announcePublication(ctx: AnnouncementContext) {
  try {
    const agent = await getLongformBot();
    if (!agent) {
      logger.debug('Longform bot not configured, skipping announcement');
      return;
    }

    const { authorHandle, title, uri, docCid, publicationUri, publicationCid, excerpt } = ctx;

    // Extract the DID and RKEY from the URI
    // URI format: at://did:plc:xxx/site.standard.document/rkey
    const parts = uri.split('/');
    if (parts.length < 5) return;
    const authorDid = parts[2];
    const rkey = parts[4];
    
    const postUrl = `https://${config.LONGFORM_DOMAIN}/post/${authorDid}/${rkey}`;
    
    const text = `New post from @${authorHandle} on Longform\n\n"${title}"\n\n${postUrl}`;
    
    const rt = new RichText({ text });
    await rt.detectFacets(agent);

    // Build associatedRefs for the enhanced Standard Site embed
    const associatedRefs: { uri: string; cid: string }[] = [
      { uri, cid: docCid },
    ];
    if (publicationUri && publicationCid) {
      associatedRefs.push({ uri: publicationUri, cid: publicationCid });
    }

    // Fetch thumbnail image from the article page's OG image if available
    let thumb: any = undefined;
    try {
      const ogRes = await fetch(postUrl, {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'longform-bot/1.0' },
      });
      if (ogRes.ok) {
        const html = await ogRes.text();
        const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
        if (ogImageMatch?.[1]) {
          const imgRes = await fetch(ogImageMatch[1], { signal: AbortSignal.timeout(5000) });
          if (imgRes.ok) {
            const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
            const buffer = new Uint8Array(await imgRes.arrayBuffer());
            const uploadRes = await agent.com.atproto.repo.uploadBlob(buffer, { encoding: mimeType });
            thumb = uploadRes.data.blob;
          }
        }
      }
    } catch (e) {
      // Non-fatal — post without thumbnail
    }

    await agent.post({
      text: rt.text,
      facets: rt.facets,
      embed: {
        $type: 'app.bsky.embed.external',
        external: {
          uri: postUrl,
          title: title,
          description: excerpt || `Read this article on ${config.LONGFORM_DOMAIN || 'Longform'}`,
          ...(thumb ? { thumb } : {}),
          associatedRefs,
        },
      } as any,
    });
    
    logger.info({ authorDid, postUrl, associatedRefs: associatedRefs.length }, 'Longform bot announced publication with enhanced embed');
  } catch (err) {
    logger.error({ err }, 'Failed to announce publication via Longform bot');
  }
}

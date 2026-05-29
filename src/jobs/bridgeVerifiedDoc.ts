import { Job } from 'pg-boss';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { getLongformBot } from '../longform/bot.js';
import { config } from '../lib/config.js';
import { RichText } from '@atproto/api';

interface BridgeDocData {
  docUri: string;
  docCid: string;
  publicationUri?: string;
  publicationCid?: string;
  site: string;
  path: string;
  title: string;
  authorDid: string;
}

/**
 * Delayed job (15 min after verified doc indexed):
 * If no organic Bluesky post has been linked to this document,
 * the Longform bot creates one with an enhanced embed so the doc
 * can appear in custom feed skeletons.
 */
export async function bridgeVerifiedDocJob(job: Job<BridgeDocData>) {
  const { docUri, docCid, publicationUri, publicationCid, site, path, title, authorDid } = job.data;

  try {
    // Already bridged? (organic post showed up in the 15-min window)
    const existing = await db.query(
      'SELECT 1 FROM doc_feed_bridge WHERE doc_uri = $1',
      [docUri]
    );
    if (existing.rowCount && existing.rowCount > 0) {
      logger.debug({ docUri }, 'Doc already bridged, skipping bot post');
      return;
    }

    const bot = await getLongformBot();
    if (!bot) {
      logger.debug('Longform bot not configured, cannot bridge doc');
      return;
    }

    // Build the article URL
    const rkey = docUri.split('/').pop();
    const postUrl = `https://${config.LONGFORM_DOMAIN}/post/${authorDid}/${rkey}`;

    const text = `${title}\n\n${postUrl}`;
    const rt = new RichText({ text });
    await rt.detectFacets(bot);

    // Build associatedRefs
    const associatedRefs: { uri: string; cid: string }[] = [
      { uri: docUri, cid: docCid },
    ];
    if (publicationUri && publicationCid) {
      associatedRefs.push({ uri: publicationUri, cid: publicationCid });
    }

    const res = await bot.post({
      text: rt.text,
      facets: rt.facets,
      embed: {
        $type: 'app.bsky.embed.external',
        external: {
          uri: postUrl,
          title: title || 'Untitled',
          description: `Read on ${config.LONGFORM_DOMAIN}`,
          associatedRefs,
        },
      } as any,
    });

    // Record the bridge
    await db.query(
      `INSERT INTO doc_feed_bridge (doc_uri, post_uri, source)
       VALUES ($1, $2, 'bot')
       ON CONFLICT (doc_uri) DO NOTHING`,
      [docUri, res.uri]
    );

    logger.info({ docUri, postUri: res.uri }, 'Bot-bridged verified doc for feed inclusion');
  } catch (err) {
    logger.error({ err, docUri }, 'Failed to bridge verified doc via bot');
  }
}

import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { AtpAgent } from '@atproto/api';

async function backfill() {
  logger.info('Starting thumbnail backfill for existing media items...');
  const agent = new AtpAgent({ service: 'https://public.api.bsky.app' });

  try {
    const { rows } = await db.query<{ id: number; uri: string }>(`
      SELECT id, uri FROM media_items
      WHERE (thumbnail_cid IS NULL OR thumbnail_cid = '') AND status = 'done' AND error IS NULL
      ORDER BY created_at DESC
    `);

    logger.info({ count: rows.length }, 'Found media items needing thumbnails');

    for (let i = 0; i < rows.length; i++) {
      const item = rows[i];
      try {
        const res = await agent.app.bsky.feed.getPostThread({ uri: item.uri, depth: 0 });
        const post = (res.data.thread as any)?.post;
        const embed = post?.embed;
        
        let thumbCid: string | null = null;
        if (embed) {
          // Check standard structure returned by AppView (which has different definitions than firehose Jetstream records)
          if (embed.$type === 'app.bsky.embed.video#view') {
            thumbCid = embed.thumbnail || null;
          } else if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
            thumbCid = embed.media?.thumbnail || null;
          }
          
          // Fallback to record structure if it is not resolved as a view
          if (!thumbCid) {
            if (embed.thumbnail?.ref?.$link) {
              thumbCid = embed.thumbnail.ref.$link;
            } else if (embed.media?.thumbnail?.ref?.$link) {
              thumbCid = embed.media.thumbnail.ref.$link;
            }
          }
        }

        if (thumbCid) {
          // If it is a full CDN URL from AppView view format, extract the CID from the query parameter/path if needed,
          // but wait! If the API returns a full HTTPS URL:
          // "https://cdn.bsky.app/img/feed_thumbnail/plain/did/cid@jpeg"
          // We can just save it or extract the CID.
          // Actually, let's extract the CID or save the URL itself!
          // Wait! In views/feed.tsx, if the thumbnail_cid is a full URL, we can render it directly!
          // Yes! If we can store either the CID or the full CDN URL, it is 100% playable/renderable!
          // Let's extract the CID if possible, otherwise keep the URL.
          let finalVal = thumbCid;
          if (thumbCid.includes('/feed_thumbnail/')) {
            // URL format: https://cdn.bsky.app/img/feed_thumbnail/plain/did/cid@jpeg
            // Split by '/' and take the last part before '@'
            const parts = thumbCid.split('/');
            const lastPart = parts[parts.length - 1];
            const cid = lastPart.split('@')[0];
            if (cid && cid.startsWith('bafy')) {
              finalVal = cid;
            }
          }
          
          await db.query('UPDATE media_items SET thumbnail_cid = $1 WHERE id = $2', [finalVal, item.id]);
          logger.info({ id: item.id, uri: item.uri, thumbnail: finalVal }, `[${i+1}/${rows.length}] Backfilled thumbnail`);
        } else {
          logger.debug({ id: item.id }, `[${i+1}/${rows.length}] No thumbnail found`);
        }
      } catch (err) {
        logger.debug({ id: item.id, err }, 'Failed to fetch thread details from AppView');
      }

      // Small sleep to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 80));

      if ((i + 1) % 50 === 0) {
        logger.info(`Processed ${i + 1} / ${rows.length} items...`);
      }
    }
    logger.info('Backfill completed successfully!');
  } catch (err) {
    logger.error({ err }, 'Backfill failed');
  } finally {
    process.exit(0);
  }
}

backfill();

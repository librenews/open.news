import { Job } from 'pg-boss';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';

/**
 * Backfills nearby_post_cache for geotagged posts that don't have cached text.
 * Uses the public Bluesky API (app.bsky.feed.getPosts) in batches of 25.
 */
export async function backfillNearbyPostsJob(job: Job) {
  try {
    // Find geotagged posts missing from both track_matches and nearby_post_cache
    const { rows: missing } = await db.query(`
      SELECT DISTINCT g.subject AS uri
      FROM nearby_geotags g
      WHERE g.subject_type = 'post'
        AND NOT EXISTS (SELECT 1 FROM track_matches m WHERE m.post_uri = g.subject)
        AND NOT EXISTS (SELECT 1 FROM nearby_post_cache pc WHERE pc.post_uri = g.subject)
      LIMIT 500
    `);

    if (missing.length === 0) {
      logger.info('No posts to backfill');
      return;
    }

    logger.info({ count: missing.length }, 'Backfilling nearby post cache');

    let fetched = 0;
    let failed = 0;

    // Process in batches of 25 (API limit for getPosts)
    for (let i = 0; i < missing.length; i += 25) {
      const batch = missing.slice(i, i + 25);
      const uris = batch.map((r: any) => r.uri);

      try {
        const params = new URLSearchParams();
        for (const uri of uris) {
          params.append('uris', uri);
        }

        const res = await fetch(
          `https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${params.toString()}`,
          { headers: { 'Accept': 'application/json' } }
        );

        if (!res.ok) {
          logger.warn({ status: res.status, batch: i }, 'getPosts API error');
          failed += batch.length;
          continue;
        }

        const data = await res.json() as any;
        const posts = data.posts || [];

        for (const post of posts) {
          const uri = post.uri;
          const did = post.author?.did || '';
          const text = post.record?.text || '';
          const embed = post.record?.embed || null;

          if (uri && did) {
            await db.query(
              `INSERT INTO nearby_post_cache (post_uri, post_did, post_text, embed)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (post_uri) DO UPDATE SET
                 post_text = CASE WHEN nearby_post_cache.post_text = '' THEN EXCLUDED.post_text ELSE nearby_post_cache.post_text END,
                 embed = COALESCE(EXCLUDED.embed, nearby_post_cache.embed)`,
              [uri, did, text, embed ? JSON.stringify(embed) : null]
            );
            fetched++;
          }
        }

        // Rate limit: 100ms between batches
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        logger.warn({ err, batch: i }, 'Failed to fetch post batch');
        failed += batch.length;
      }
    }

    logger.info({ fetched, failed, total: missing.length }, 'Nearby post cache backfill complete');
  } catch (err: any) {
    logger.error({ err, message: err?.message }, 'Failed to backfill nearby posts');
    throw err;
  }
}

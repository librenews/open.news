import { db } from '../db/client.js';
import { deleteMediaDocument } from '../track/opensearch.js';
import { logger } from '../lib/logger.js';

async function runCleanup() {
  logger.info('Starting Snip database and search index cleanup...');

  try {
    // ── STAGE 1: Delete by local keywords & transcripts ──
    const { rows } = await db.query<{ uri: string }>(`
      SELECT uri FROM media_items mi
      LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
      WHERE mt.language != 'en'
         OR mt.text = 'silent'
         OR mt.text IS NULL
         OR mi.post_text ~* '\\y(porn|sex|xxx|nsfw|nude|naked|erotic|milf|dilf|penis|vagina|boobs|tits|fuck|cock|dick|fetish|twink|gay|onlyfans)\\y'
         OR mi.alt_text ~* '\\y(porn|sex|xxx|nsfw|nude|naked|erotic|milf|dilf|penis|vagina|boobs|tits|fuck|cock|dick|fetish|twink|gay|onlyfans)\\y'
         OR mt.text ~* '\\y(porn|sex|xxx|nsfw|nude|naked|erotic|milf|dilf|penis|vagina|boobs|tits|fuck|cock|dick|fetish|twink|gay|onlyfans)\\y'
    `);

    const localUris = rows.map(r => r.uri);
    logger.info({ count: localUris.length }, 'Found media items to delete based on local keywords');

    if (localUris.length > 0) {
      await db.query('DELETE FROM media_items WHERE uri = ANY($1)', [localUris]);
      for (const uri of localUris) {
        await deleteMediaDocument(uri);
      }
      logger.info('Purged local keyword matches from PG and OpenSearch.');
    }

    // ── STAGE 2: Query Bluesky AppView live for moderation labels ──
    const { rows: activeRows } = await db.query<{ uri: string; did: string }>(`
      SELECT uri, did FROM media_items
      WHERE status = 'done' AND error IS NULL
    `);
    logger.info({ count: activeRows.length }, 'Checking live moderation labels for remaining active items...');

    const flaggedUris: string[] = [];
    const CHUNK_SIZE = 10;

    for (let i = 0; i < activeRows.length; i += CHUNK_SIZE) {
      const chunk = activeRows.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (item) => {
          try {
            // 1. Fetch live post details & labels
            const postUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(item.uri)}&depth=0`;
            const postRes = await fetch(postUrl);
            if (postRes.ok) {
              const data = await postRes.json() as any;
              const postVal = data?.thread?.post;
              
              const postLabels = postVal?.labels || [];
              const hasNsfwPostLabel = postLabels.some((l: any) =>
                ['porn', 'sexual', 'nudity', 'nsfw', 'explicit', 'erotic', 'underwear', 'sexual-figurative'].includes(String(l.val || '').toLowerCase())
              );
              if (hasNsfwPostLabel) {
                flaggedUris.push(item.uri);
                return;
              }
            }

            // 2. Fetch live profile details & labels
            const profileUrl = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(item.did)}`;
            const profileRes = await fetch(profileUrl);
            if (profileRes.ok) {
              const profile = await profileRes.json() as any;
              
              const authorLabels = profile?.labels || [];
              const hasNsfwAuthorLabel = authorLabels.some((l: any) =>
                ['porn', 'sexual', 'nudity', 'nsfw', 'explicit', 'erotic', 'underwear'].includes(String(l.val || '').toLowerCase())
              );
              if (hasNsfwAuthorLabel) {
                flaggedUris.push(item.uri);
                return;
              }

              // Double check profile bio/name keywords
              const profileText = `${profile.displayName ?? ''} ${profile.description ?? ''}`.toLowerCase();
              const isNsfwProfile = /\b(porn|sex|xxx|nsfw|nude|naked|erotic|onlyfans|only fans|linktree|18\+|adult|kink|twink|fetish|fuck|cock|dick)\b/i.test(profileText);
              if (isNsfwProfile) {
                flaggedUris.push(item.uri);
              }
            }
          } catch (err) {
            // Non-blocking error for individual checks
          }
        })
      );

      if ((i + CHUNK_SIZE) % 50 === 0 || i + CHUNK_SIZE >= activeRows.length) {
        logger.info(`Processed ${Math.min(i + CHUNK_SIZE, activeRows.length)} / ${activeRows.length} active items...`);
      }
    }

    if (flaggedUris.length > 0) {
      logger.info({ count: flaggedUris.length }, 'Found media items to delete based on live moderation labels');
      await db.query('DELETE FROM media_items WHERE uri = ANY($1)', [flaggedUris]);
      for (const uri of flaggedUris) {
        await deleteMediaDocument(uri);
      }
      logger.info('Purged live flagged records from PG and OpenSearch.');
    } else {
      logger.info('No additional flagged items found via live moderation label check.');
    }

    logger.info('Cleanup completed successfully.');
  } catch (err) {
    logger.error({ err }, 'Cleanup failed');
  } finally {
    process.exit(0);
  }
}

runCleanup();

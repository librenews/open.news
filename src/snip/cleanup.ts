import { db } from '../db/client.js';
import { deleteMediaDocument } from '../track/opensearch.js';
import { logger } from '../lib/logger.js';

async function runCleanup() {
  logger.info('Starting Snip database and search index cleanup...');

  try {
    // 1. Find all URIs of media items that should be deleted
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

    const uris = rows.map(r => r.uri);
    logger.info({ count: uris.length }, 'Found media items to delete');

    if (uris.length > 0) {
      // 2. Delete from PostgreSQL (cascades to transcripts/embeddings/interactions)
      await db.query('DELETE FROM media_items WHERE uri = ANY($1)', [uris]);
      logger.info('Deleted records from PostgreSQL');

      // 3. Delete from OpenSearch
      for (const uri of uris) {
        await deleteMediaDocument(uri);
      }
      logger.info('Deleted records from OpenSearch');
    }

    logger.info('Cleanup completed successfully.');
  } catch (err) {
    logger.error({ err }, 'Cleanup failed');
  } finally {
    process.exit(0);
  }
}

runCleanup();

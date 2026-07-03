/**
 * Backfill existing completed media items from PostgreSQL into OpenSearch.
 *
 * Usage: npx tsx src/scripts/backfillMediaOs.ts
 */
import { db } from '../db/client.js';
import { getOsClient, MEDIA_INDEX, ensureMediaIndex } from '../track/opensearch.js';

async function main() {
  const os = getOsClient();
  
  // Ensure the index exists
  console.log('Ensuring OpenSearch media index exists...');
  await ensureMediaIndex();

  // Query all done items
  const { rows } = await db.query(`
    SELECT mi.uri, mi.did, mi.media_type, mi.source_url, mi.alt_text, mi.post_text, mi.duration_ms, mi.created_at,
           mt.text as transcript, mt.language,
           me.embedding
    FROM media_items mi
    LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
    LEFT JOIN media_embeddings me ON me.media_id = mi.id
    WHERE mi.status = 'done'
  `);

  console.log(`Found ${rows.length} completed media items in Postgres`);

  const bulkBody: any[] = [];
  for (const row of rows) {
    bulkBody.push({ index: { _index: MEDIA_INDEX, _id: row.uri } });
    
    const document: Record<string, any> = {
      uri: row.uri,
      did: row.did,
      media_type: row.media_type,
      source_url: row.source_url || null,
      alt_text: row.alt_text || null,
      post_text: row.post_text || null,
      transcript: row.transcript || null,
      language: row.language || null,
      duration_ms: row.duration_ms ? parseInt(row.duration_ms, 10) : null,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    };

    if (row.embedding) {
      document.audio_embedding = row.embedding;
    }
    
    bulkBody.push(document);
  }

  if (bulkBody.length > 0) {
    const result = await os.bulk({ body: bulkBody });
    if (result.body.errors) {
      const failed = result.body.items?.filter((i: any) => i.index?.error);
      console.error(`Errors occurred during bulk index (${failed.length} failed):`, JSON.stringify(failed.slice(0, 5)));
    } else {
      console.log(`Successfully backfilled ${rows.length} media items into OpenSearch`);
    }
  } else {
    console.log('No media items to index');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

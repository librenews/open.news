/**
 * Backfill categories for existing media transcripts.
 *
 * Runs through all transcripts that don't yet have a category assigned
 * and classifies them using the LLM. Processes in batches to avoid
 * overwhelming the LLM API.
 *
 * Usage: npx tsx src/snip/backfill_categories.ts [--batch-size=50] [--delay-ms=200]
 */
import { db } from '../db/client.js';
import { classifyTranscript } from './categories.js';
import { logger } from '../lib/logger.js';

const BATCH_SIZE = parseInt(process.argv.find(a => a.startsWith('--batch-size='))?.split('=')[1] || '50', 10);
const DELAY_MS = parseInt(process.argv.find(a => a.startsWith('--delay-ms='))?.split('=')[1] || '200', 10);

async function backfill() {
  // Count total unclassified
  const { rows: [{ count }] } = await db.query<{ count: string }>(
    `SELECT count(*) FROM media_transcripts WHERE category IS NULL`
  );
  const total = parseInt(count, 10);
  logger.info({ total, batchSize: BATCH_SIZE, delayMs: DELAY_MS }, 'Starting category backfill');

  let processed = 0;
  let classified = 0;

  while (true) {
    // Fetch a batch of unclassified transcripts
    const { rows } = await db.query<{ id: number; text: string; language: string | null }>(
      `SELECT id, text, language
       FROM media_transcripts
       WHERE category IS NULL
       ORDER BY id ASC
       LIMIT $1`,
      [BATCH_SIZE]
    );

    if (rows.length === 0) break;

    for (const row of rows) {
      // Skip non-English transcripts (classify as uncategorized)
      if (row.language && row.language !== 'en') {
        await db.query(
          `UPDATE media_transcripts SET category = 'uncategorized', category_confidence = 0 WHERE id = $1`,
          [row.id]
        );
        processed++;
        continue;
      }

      try {
        const result = await classifyTranscript(row.text);
        await db.query(
          `UPDATE media_transcripts
           SET category = $1, category_confidence = $2, secondary_category = $3
           WHERE id = $4`,
          [result.category, result.confidence, result.secondary_category, row.id]
        );

        if (result.category !== 'uncategorized') classified++;
        processed++;

        if (processed % 100 === 0) {
          logger.info({ processed, classified, total }, 'Backfill progress');
        }

        // Rate limit to avoid hammering the LLM API
        if (DELAY_MS > 0) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
      } catch (err) {
        logger.error({ err, transcriptId: row.id }, 'Failed to classify transcript');
        // Mark as uncategorized so we don't retry forever
        await db.query(
          `UPDATE media_transcripts SET category = 'uncategorized', category_confidence = 0 WHERE id = $1`,
          [row.id]
        );
        processed++;
      }
    }
  }

  logger.info({ processed, classified, total }, 'Category backfill complete');
  process.exit(0);
}

backfill().catch(err => {
  logger.error({ err }, 'Backfill failed');
  process.exit(1);
});

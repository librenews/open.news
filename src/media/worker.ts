/**
 * Media Worker — processes video/audio from the firehose.
 *
 * Reads from Redis stream "media:items", downloads video blobs,
 * extracts audio, sends to the GPU media service for transcription
 * and embedding, and stores results in PostgreSQL + OpenSearch.
 *
 * Follows the same consumer group pattern as src/track/worker.ts.
 */

import { getRedis } from '../lib/redis.js';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { config } from '../lib/config.js';
import { downloadAndExtractAudio, buildBlobUrl, cleanupTempFile } from './download.js';
import { processAudio, checkHealth } from './mediaClient.js';

const STREAM_KEY = 'media:items';
const GROUP_NAME = 'media-workers';
const CONSUMER_NAME = `worker-${process.pid}`;
const BATCH_SIZE = 8;
const BLOCK_MS = 5000;
const STATS_INTERVAL_MS = 30_000;

// Stats
const stats = { processed: 0, failed: 0, skipped: 0, gpuCalls: 0 };

// ─── Consumer group setup ────────────────────────────────────────────────────

async function ensureConsumerGroup(): Promise<void> {
  const redis = getRedis();
  try {
    await redis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '0', 'MKSTREAM');
    logger.info({ stream: STREAM_KEY, group: GROUP_NAME }, 'Created consumer group');
  } catch (err: any) {
    if (err.message?.includes('BUSYGROUP')) {
      logger.debug('Consumer group already exists');
    } else {
      throw err;
    }
  }
}

// ─── Insert media item into DB ───────────────────────────────────────────────

async function insertMediaItem(fields: Record<string, string>): Promise<number | null> {
  try {
    const langs = fields.langs ? fields.langs.split(',').filter(Boolean) : [];
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO media_items (uri, did, rkey, cid, media_type, source_url, alt_text, aspect_ratio, post_text, post_langs, firehose_ts, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
       ON CONFLICT (uri) DO NOTHING
       RETURNING id`,
      [
        fields.uri, fields.did, fields.rkey, fields.cid || null,
        fields.mediaType, fields.sourceUrl || null, fields.altText || null,
        fields.aspectRatio || null, fields.postText || null,
        langs.length > 0 ? langs : null, fields.ts ? BigInt(fields.ts) : null,
      ]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    logger.error({ err, uri: fields.uri }, 'Failed to insert media item');
    return null;
  }
}

// ─── Process a single media item ─────────────────────────────────────────────

async function processMediaItem(mediaId: number, fields: Record<string, string>): Promise<void> {
  const { uri, sourceUrl, mediaType } = fields;
  let audioPath: string | null = null;

  try {
    // Update status to downloading
    await db.query('UPDATE media_items SET status = $1 WHERE id = $2', ['downloading', mediaId]);

    // Download video and extract audio
    if (mediaType === 'video') {
      // Use sourceUrl if it's a valid getBlob URL, otherwise rebuild from DID+CID
      let downloadUrl = sourceUrl;
      if (!downloadUrl || !downloadUrl.includes('getBlob')) {
        if (fields.did && fields.cid) {
          downloadUrl = buildBlobUrl(fields.did, fields.cid);
        }
      }
      if (downloadUrl) {
        audioPath = await downloadAndExtractAudio(downloadUrl, `media_${mediaId}`);
      }
    }

    if (!audioPath) {
      // Can't process without audio — mark as skipped
      await db.query(
        'UPDATE media_items SET status = $1, error = $2 WHERE id = $3',
        ['skipped', 'No audio extracted', mediaId]
      );
      stats.skipped++;
      return;
    }

    // Update status to processing
    await db.query('UPDATE media_items SET status = $1 WHERE id = $2', ['processing', mediaId]);

    // Send to GPU service
    stats.gpuCalls++;
    const result = await processAudio(audioPath);

    // Store transcript
    if (result.transcript) {
      await db.query(
        `INSERT INTO media_transcripts (media_id, language, text, segments, model, confidence)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (media_id) DO UPDATE SET
           language = EXCLUDED.language, text = EXCLUDED.text,
           segments = EXCLUDED.segments, model = EXCLUDED.model,
           confidence = EXCLUDED.confidence`,
        [
          mediaId,
          result.transcript.language,
          result.transcript.text,
          JSON.stringify(result.transcript.segments),
          result.transcript.model,
          result.transcript.language_probability,
        ]
      );
    }

    // Store embedding
    if (result.embedding) {
      await db.query(
        `INSERT INTO media_embeddings (media_id, embedding, model, audio_features)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (media_id) DO UPDATE SET
           embedding = EXCLUDED.embedding, model = EXCLUDED.model,
           audio_features = EXCLUDED.audio_features`,
        [
          mediaId,
          result.embedding,
          'laion/larger_clap_music_and_speech',
          result.audio_features ? JSON.stringify(result.audio_features) : null,
        ]
      );
    }

    // Update duration from audio features if available
    if (result.audio_features?.duration_s) {
      await db.query(
        'UPDATE media_items SET duration_ms = $1 WHERE id = $2',
        [Math.round(result.audio_features.duration_s * 1000), mediaId]
      );
    }

    // Mark as done
    await db.query(
      'UPDATE media_items SET status = $1, processed_at = NOW() WHERE id = $2',
      ['done', mediaId]
    );
    stats.processed++;

  } catch (err: any) {
    const errMsg = String(err);
    if (errMsg.includes('does not contain any stream')) {
      logger.info({ uri, mediaId }, 'Video has no audio stream (silent), marking as done');
      await db.query(
        'UPDATE media_items SET status = $1, error = $2, processed_at = NOW() WHERE id = $3',
        ['done', 'silent', mediaId]
      ).catch(() => {});
      stats.processed++;
    } else if (errMsg.includes('Downloaded file too small') || errMsg.includes('not found on disk')) {
      logger.warn({ uri, mediaId }, 'Blob download failed/not found, marking as skipped');
      await db.query(
        'UPDATE media_items SET status = $1, error = $2 WHERE id = $3',
        ['skipped', errMsg, mediaId]
      ).catch(() => {});
      stats.skipped++;
    } else {
      logger.error({ err, uri, mediaId }, 'Failed to process media item');
      await db.query(
        'UPDATE media_items SET status = $1, error = $2 WHERE id = $3',
        ['failed', errMsg, mediaId]
      ).catch(() => {});
      stats.failed++;
    }
  } finally {
    // Always clean up temp audio file
    if (audioPath) {
      cleanupTempFile(audioPath);
    }
  }
}

// ─── Main loop ───────────────────────────────────────────────────────────────

async function runLoop(): Promise<void> {
  const redis = getRedis();

  while (true) {
    try {
      const results = await redis.xreadgroup(
        'GROUP', GROUP_NAME, CONSUMER_NAME,
        'COUNT', BATCH_SIZE,
        'BLOCK', BLOCK_MS,
        'STREAMS', STREAM_KEY, '>'
      ) as [string, [string, string[]][]][] | null;

      if (!results || results.length === 0) continue;

      const messages = results[0][1]; // [messageId, [field, value, ...]][]
      const ackIds: string[] = [];

      for (const [msgId, rawFields] of messages) {
        // Parse flat array into key-value object
        const fields: Record<string, string> = {};
        for (let i = 0; i < rawFields.length; i += 2) {
          fields[rawFields[i]] = rawFields[i + 1];
        }

        // Insert into DB (dedup via UNIQUE constraint)
        const mediaId = await insertMediaItem(fields);
        if (mediaId === null) {
          // Duplicate or error — skip processing but ACK
          stats.skipped++;
          ackIds.push(msgId);
          continue;
        }

        // Process the media item
        await processMediaItem(mediaId, fields);
        ackIds.push(msgId);
      }

      // ACK all processed messages
      if (ackIds.length > 0) {
        await redis.xack(STREAM_KEY, GROUP_NAME, ...ackIds);
      }

    } catch (err) {
      logger.error({ err }, 'Media worker loop error');
      // Brief pause before retrying on error
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ─── Startup ─────────────────────────────────────────────────────────────────

async function start() {
  logger.info('Media worker starting...');

  await ensureConsumerGroup();

  // Check if GPU service is available (non-blocking)
  try {
    const health = await checkHealth();
    logger.info({ health }, 'GPU media service status');
  } catch {
    logger.warn('GPU media service not available — items will be queued but processing will fail until service starts');
  }

  // Stats logging
  setInterval(() => {
    logger.info(stats, 'Media worker stats (last 30s)');
    stats.processed = 0;
    stats.failed = 0;
    stats.skipped = 0;
    stats.gpuCalls = 0;
  }, STATS_INTERVAL_MS);

  // Start processing
  runLoop();

  logger.info('Media worker started');
}

start().catch(err => {
  logger.error({ err }, 'Media worker startup failed');
  process.exit(1);
});

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import parquet from '@dsnp/parquetjs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '../../lib/logger.js';
import 'dotenv/config';

const DATA_DIR = 'data/embeddings';
const CURRENT_FILE = path.join(DATA_DIR, 'current.jsonl');

const s3 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const schema = new parquet.ParquetSchema({
  uri: { type: 'UTF8' },
  did: { type: 'UTF8' },
  text: { type: 'UTF8' },
  embedding: { type: 'DOUBLE', repeated: true },
  timestamp: { type: 'UTF8' },
});

async function main() {
  if (process.env.ENABLE_EMBEDDING_ARCHIVER !== 'true') {
    logger.info('Embedding archiver is disabled (ENABLE_EMBEDDING_ARCHIVER != true), skipping execution');
    return;
  }
  if (!fs.existsSync(CURRENT_FILE)) {
    logger.info('No current.jsonl found, skipping archive');
    return;
  }

  const stat = fs.statSync(CURRENT_FILE);
  if (stat.size === 0) {
    logger.info('current.jsonl is empty, skipping archive');
    return;
  }

  // 1. Rotate the file safely
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const processingJsonl = path.join(DATA_DIR, `processing-${timestamp}.jsonl`);
  const processingParquet = path.join(DATA_DIR, `archive-${timestamp}.parquet`);

  fs.renameSync(CURRENT_FILE, processingJsonl);
  logger.info({ size: stat.size, file: processingJsonl }, 'Rotated embeddings log buffer');

  // 2. Convert JSONL to Parquet
  let rowsWritten = 0;
  const writer = await parquet.ParquetWriter.openFile(schema, processingParquet);
  
  const fileStream = fs.createReadStream(processingJsonl);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      await writer.appendRow({
        uri: row.uri,
        did: row.did,
        text: row.text,
        embedding: row.embedding,
        timestamp: row.timestamp,
      });
      rowsWritten++;
    } catch (err) {
      logger.error({ err, line: line.slice(0, 50) }, 'Failed to parse JSONL row');
    }
  }

  await writer.close();
  logger.info({ rows: rowsWritten, file: processingParquet }, 'Converted JSONL to highly-compressed Parquet');

  if (rowsWritten === 0) {
    fs.unlinkSync(processingJsonl);
    fs.unlinkSync(processingParquet);
    return;
  }

  // 3. Upload to S3
  const bucket = process.env.S3_BUCKET || 'track-embeddings';
  const objectKey = `bsky-embeddings/archive-${timestamp}.parquet`;

  logger.info({ bucket, key: objectKey }, 'Uploading to S3 object storage...');
  
  const parquetBuffer = fs.readFileSync(processingParquet);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: parquetBuffer,
      ContentType: 'application/vnd.apache.parquet',
    })
  );

  logger.info('S3 upload successful!');

  // 4. Cleanup local files to free up disk space
  fs.unlinkSync(processingJsonl);
  fs.unlinkSync(processingParquet);
  logger.info('Cleaned up local processing files');
}

main().catch((err) => {
  logger.error({ err }, 'CRITICAL ERROR: Failed to archive embeddings');
  process.exit(1);
});

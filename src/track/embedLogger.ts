import fs, { WriteStream } from 'fs';
import path from 'process';
import { logger } from '../lib/logger.js';

const DATA_DIR = 'data/embeddings';
const CURRENT_FILE = `${DATA_DIR}/current.jsonl`;

// Only initialize the logger if the feature is enabled
const IS_ENABLED = process.env.ENABLE_EMBEDDING_ARCHIVER === 'true';

let stream: WriteStream | null = null;

if (IS_ENABLED) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    logger.error({ err }, 'Failed to create embeddings data directory');
  }

  stream = fs.createWriteStream(CURRENT_FILE, { flags: 'a' });
  stream.on('error', (err) => {
    logger.error({ err }, 'EmbedLogger stream error');
  });
}

export interface LoggedPost {
  uri: string;
  did: string;
  text: string;
  embedding: number[];
  timestamp: string;
}

/**
 * High-performance fire-and-forget logging of post embeddings.
 * Writes straight to the OS buffer, unblocking the Node event loop.
 */
export function logEmbeddings(posts: { uri: string; did: string; text: string }[], embeddings: number[][]): void {
  if (!IS_ENABLED) return; // Feature is disabled by default

  const ts = new Date().toISOString();
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const row: LoggedPost = {
      uri: p.uri,
      did: p.did,
      text: p.text,
      embedding: embeddings[i],
      timestamp: ts,
    };
    
    if (stream && !stream.writable) {
      stream = fs.createWriteStream(CURRENT_FILE, { flags: 'a' });
      stream.on('error', (e) => logger.error({ err: e }, 'EmbedLogger stream error'));
    }
    
    if (stream) {
      stream.write(JSON.stringify(row) + '\n');
    }
  }
}

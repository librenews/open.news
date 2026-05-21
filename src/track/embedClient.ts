import { logger } from '../lib/logger.js';

const EMBED_URL = process.env.EMBED_SERVICE_URL ?? 'http://localhost:8100';

interface EmbedResponse {
  embeddings: number[][];
  is_toxic: boolean[];
  model: string;
  dimension: number;
  elapsed_ms: number;
}

interface HealthResponse {
  status: string;
  model: string;
  device: string;
  dimension: number;
  cuda_available: boolean;
}

/** Batch-embed an array of texts. Returns embeddings and toxicity masks. */
export async function embedTexts(texts: string[]): Promise<{embeddings: number[][], isToxic: boolean[]}> {
  if (texts.length === 0) return { embeddings: [], isToxic: [] };

  const res = await fetch(`${EMBED_URL}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Embed service error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as EmbedResponse;
  logger.debug({ count: texts.length, elapsed_ms: data.elapsed_ms }, 'Batch embedded');
  return {
    embeddings: data.embeddings,
    isToxic: data.is_toxic || new Array(texts.length).fill(false)
  };
}

/** Embed a single text. */
export async function embedText(text: string): Promise<number[]> {
  const { embeddings } = await embedTexts([text]);
  return embeddings[0];
}

/** Check if the embed service is healthy. */
export async function checkEmbedHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${EMBED_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Cached embed dimension — auto-detected from the service's /health endpoint. */
let _cachedDimension: number | null = null;

/** Get the embedding dimension from the running embed service. Cached after first call. */
export async function getEmbedDimension(): Promise<number> {
  if (_cachedDimension) return _cachedDimension;
  try {
    const res = await fetch(`${EMBED_URL}/health`);
    if (res.ok) {
      const data = (await res.json()) as HealthResponse;
      _cachedDimension = data.dimension;
      logger.info({ dimension: data.dimension, model: data.model }, 'Auto-detected embed dimension');
      return data.dimension;
    }
  } catch {}
  // Fallback to config
  const { config } = await import('../lib/config.js');
  _cachedDimension = config.EMBED_DIMENSION;
  logger.warn({ dimension: _cachedDimension }, 'Failed to auto-detect embed dimension, using config fallback');
  return _cachedDimension;
}

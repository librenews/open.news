import { logger } from '../lib/logger.js';

const EMBED_URL = process.env.EMBED_SERVICE_URL ?? 'http://localhost:8100';

interface EmbedResponse {
  embeddings: number[][];
  is_toxic: boolean[];
  model: string;
  dimension: number;
  elapsed_ms: number;
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

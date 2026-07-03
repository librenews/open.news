/**
 * HTTP client for the GPU media processing service.
 *
 * Communicates with the Python FastAPI service (media_service.py)
 * running on port 8101. Same pattern as src/track/embedClient.ts.
 */

import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

const MEDIA_SERVICE_URL = process.env.MEDIA_SERVICE_URL || 'http://localhost:8101';
const REQUEST_TIMEOUT_MS = 300_000; // 5 minutes — transcription can be slow for long videos

// ─── Types ───────────────────────────────────────────────────────────────────

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface TranscriptResult {
  text: string;
  language: string;
  language_probability: number;
  segments: TranscriptSegment[];
  duration_s: number;
  model: string;
}

interface ProcessResult {
  transcript: TranscriptResult | null;
  embedding: number[] | null;
  audio_features: Record<string, number> | null;
  elapsed_ms: number;
}

interface HealthResult {
  status: string;
  device: string;
  whisper_loaded: boolean;
  clap_loaded: boolean;
  clap_dimension: number;
  gpu_memory: { allocated_gb: number; reserved_gb: number } | null;
}

// ─── API calls ───────────────────────────────────────────────────────────────

/**
 * Full processing pipeline: transcribe + embed audio.
 */
export async function processAudio(
  audioPath: string,
  options?: { transcribe?: boolean; embed?: boolean }
): Promise<ProcessResult> {
  const body = {
    audio_path: audioPath,
    transcribe: options?.transcribe ?? true,
    embed: options?.embed ?? true,
  };

  const res = await fetch(`${MEDIA_SERVICE_URL}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Media service /process failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<ProcessResult>;
}

/**
 * Check service health and model status.
 */
export async function checkHealth(): Promise<HealthResult> {
  const res = await fetch(`${MEDIA_SERVICE_URL}/health`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`Media service /health failed (${res.status})`);
  }

  return res.json() as Promise<HealthResult>;
}

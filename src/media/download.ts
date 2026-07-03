/**
 * Media download utilities.
 *
 * Downloads video blobs from Bluesky PDS via com.atproto.sync.getBlob
 * and extracts audio using ffmpeg for GPU processing.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, unlink, access, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { logger } from '../lib/logger.js';

const execFileP = promisify(execFile);

const DOWNLOAD_TIMEOUT_MS = 60_000; // 60s timeout for video download
const FFMPEG_TIMEOUT_MS = 120_000;  // 120s timeout for audio extraction

/**
 * Build the PDS blob download URL for a Bluesky video.
 * Uses bsky.social as a proxy (it forwards getBlob to the correct PDS).
 */
export function buildBlobUrl(did: string, cid: string): string {
  return `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
}

/**
 * Download a video from a URL, extract audio as 16kHz mono WAV.
 * Returns the path to the extracted audio file, or null if failed.
 */
export async function downloadAndExtractAudio(
  videoUrl: string,
  filePrefix: string
): Promise<string | null> {
  let videoPath: string | null = null;
  let audioPath: string | null = null;

  try {
    // Create temp directory for this item
    const tempDir = await mkdtemp(join(tmpdir(), 'media-'));
    videoPath = join(tempDir, `${filePrefix}.mp4`);
    audioPath = join(tempDir, `${filePrefix}.wav`);

    // Download video blob via PDS getBlob endpoint
    logger.debug({ url: videoUrl, path: videoPath }, 'Downloading video blob');
    await execFileP('curl', [
      '-sL',                    // silent, follow redirects
      '--max-time', '60',       // 60s total timeout
      '--max-filesize', '104857600', // 100MB max
      '-o', videoPath,
      videoUrl,
    ], { timeout: DOWNLOAD_TIMEOUT_MS });

    // Verify the file exists and has content
    try {
      const fileInfo = await stat(videoPath);
      if (fileInfo.size < 1000) {
        logger.warn({ url: videoUrl, size: fileInfo.size }, 'Downloaded file too small, likely an error response');
        return null;
      }
    } catch {
      logger.warn({ url: videoUrl }, 'Downloaded file not found');
      return null;
    }

    // Extract audio with ffmpeg: 16kHz mono WAV (optimal for Whisper)
    logger.debug({ input: videoPath, output: audioPath }, 'Extracting audio');
    await execFileP('ffmpeg', [
      '-i', videoPath,
      '-ar', '16000',           // 16kHz sample rate (Whisper optimal)
      '-ac', '1',               // mono
      '-f', 'wav',              // WAV format
      '-y',                     // overwrite output
      '-loglevel', 'error',     // suppress noise
      audioPath,
    ], { timeout: FFMPEG_TIMEOUT_MS });

    // Clean up the video file immediately (we only need the audio)
    cleanupTempFile(videoPath);
    videoPath = null; // prevent double-cleanup

    logger.debug({ audioPath }, 'Audio extracted successfully');
    return audioPath;

  } catch (err) {
    logger.error({ err, videoUrl }, 'Failed to download/extract audio');
    // Clean up on failure
    if (videoPath) cleanupTempFile(videoPath);
    if (audioPath) cleanupTempFile(audioPath);
    return null;
  }
}

/**
 * Clean up a temp file (fire-and-forget).
 */
export function cleanupTempFile(filePath: string): void {
  unlink(filePath).catch(() => {
    // Also try to clean the parent temp directory
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    if (dir.includes('media-')) {
      import('fs/promises').then(fs =>
        fs.rm(dir, { recursive: true, force: true }).catch(() => {})
      );
    }
  });
}

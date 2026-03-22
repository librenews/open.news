import { composeBotReply, splitReply } from '../services/bot.js';
import { getUserByDid } from '../db/queries/users.js';
import { db } from '../db/client.js';
import { postReply, sendDm } from '../services/atproto.js';
import { logger } from '../lib/logger.js';

export interface BotReplyJobData {
  postUri: string;
  postCid: string;
  senderDid: string;
  text: string;
  interactionType: 'mention' | 'dm';
  convoId?: string;
}

// ─── Adaptive rate limiter (sliding window + exponential backoff) ─────────────
//
// Modeled after DDoS protection:
// - Track request timestamps in a sliding window
// - Allow a burst of messages normally (MIN_GAP between each)
// - If burst threshold is exceeded in the window, apply exponential backoff
// - Reset backoff after a quiet period

interface RateLimitState {
  timestamps: number[];   // recent request timestamps within the window
  backoffLevel: number;   // current backoff multiplier (0 = normal, 1+ = throttled)
  lastRequest: number;    // last request timestamp
}

const rateLimitState = new Map<string, RateLimitState>();

// Configuration
const WINDOW_MS = 5 * 60 * 1000;          // 5-minute sliding window
const BURST_THRESHOLD = 10;               // max requests in window before backoff
const MIN_GAP_MS = 2_000;                 // 2s minimum between any requests
const BACKOFF_BASE_MS = 15_000;           // 15s base backoff
const BACKOFF_MAX_MS = 10 * 60 * 1000;    // 10-minute max backoff
const QUIET_RESET_MS = 5 * 60 * 1000;     // reset backoff after 5 min of silence

function getRateLimitKey(senderDid: string, interactionType: string): string {
  return `${senderDid}:${interactionType}`;
}

/**
 * Check if a request should be rate-limited.
 * Returns { allowed: true } or { allowed: false, retryAfterMs }.
 */
export function checkRateLimit(
  key: string,
  now = Date.now()
): { allowed: boolean; retryAfterMs?: number; reason?: string } {
  let state = rateLimitState.get(key);

  if (!state) {
    state = { timestamps: [], backoffLevel: 0, lastRequest: 0 };
    rateLimitState.set(key, state);
  }

  // Prune timestamps outside the sliding window
  state.timestamps = state.timestamps.filter((t) => now - t < WINDOW_MS);

  // Reset backoff after quiet period
  if (state.lastRequest > 0 && now - state.lastRequest >= QUIET_RESET_MS) {
    if (state.backoffLevel > 0) {
      logger.info({ key, previousLevel: state.backoffLevel }, 'Rate limit backoff reset after quiet period');
    }
    state.backoffLevel = 0;
  }

  // Enforce minimum gap between requests
  const sinceLastMs = now - state.lastRequest;
  if (state.lastRequest > 0 && sinceLastMs < MIN_GAP_MS) {
    return { allowed: false, retryAfterMs: MIN_GAP_MS - sinceLastMs, reason: 'min_gap' };
  }

  // If in backoff, check if enough time has passed
  if (state.backoffLevel > 0) {
    const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, state.backoffLevel - 1), BACKOFF_MAX_MS);
    if (sinceLastMs < backoffMs) {
      return { allowed: false, retryAfterMs: backoffMs - sinceLastMs, reason: `backoff_level_${state.backoffLevel}` };
    }
  }

  // Check burst threshold
  if (state.timestamps.length >= BURST_THRESHOLD) {
    // Escalate backoff
    state.backoffLevel = Math.min(state.backoffLevel + 1, 6); // cap at level 6 (~10min)
    const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, state.backoffLevel - 1), BACKOFF_MAX_MS);
    state.lastRequest = now;
    logger.warn(
      { key, level: state.backoffLevel, backoffMs, windowRequests: state.timestamps.length },
      'Rate limit backoff escalated'
    );
    return { allowed: false, retryAfterMs: backoffMs, reason: `burst_exceeded_level_${state.backoffLevel}` };
  }

  // Allowed — record the request
  state.timestamps.push(now);
  state.lastRequest = now;
  return { allowed: true };
}

export async function botReplyJob(data: BotReplyJobData): Promise<void> {
  const { postUri, postCid, senderDid, text, interactionType, convoId } = data;

  // Strip @mention prefix from text
  const question = text.replace(/@[a-zA-Z0-9.-]+/g, '').trim();
  if (!question) return;

  const user = await getUserByDid(senderDid);
  const key = getRateLimitKey(senderDid, interactionType);
  const rateCheck = checkRateLimit(key);

  if (!rateCheck.allowed) {
    logger.info(
      { senderDid, interactionType, reason: rateCheck.reason, retryAfterMs: rateCheck.retryAfterMs },
      'Bot reply rate-limited'
    );
    return;
  }

  try {
    const { text: replyText, articlesUsed, llmProvider } = await composeBotReply({
      senderDid,
      question,
      interactionType,
      postUri,
      convoId,
    });

    const parts = splitReply(replyText);

    if (interactionType === 'mention') {
      let parentUri = postUri;
      let parentCid = postCid;
      for (const part of parts) {
        await postReply({ text: part, replyToUri: parentUri, replyToCid: parentCid });
      }
    } else if (interactionType === 'dm' && convoId) {
      for (const part of parts) {
        await sendDm(convoId, part);
      }
    }

    // Log interaction
    await db.query(
      `INSERT INTO bot_interactions (post_uri, sender_did, user_id, interaction_type, input_text, response_text, llm_provider, articles_used)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        postUri,
        senderDid,
        user?.id ?? null,
        interactionType,
        question,
        replyText,
        llmProvider,
        articlesUsed.map(String),
      ]
    );

    logger.info({ senderDid, interactionType, parts: parts.length }, 'Bot reply sent');
  } catch (err) {
    logger.error({ err, senderDid }, 'Bot reply failed');
    throw err; // pg-boss will retry
  }
}

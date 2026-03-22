import { composeBotReply, splitReply } from '../services/bot.js';
import { getUserByDid } from '../db/queries/users.js';
import { db } from '../db/client.js';
import { postReply, sendDm } from '../services/atproto.js';
import { classifyIntentHybrid } from '../services/intentRouter.js';
import { insertFeedback } from '../db/queries/feedback.js';
import { llm, type LLMMessage } from '../services/llm.js';
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

interface RateLimitState {
  timestamps: number[];
  backoffLevel: number;
  lastRequest: number;
}

const rateLimitState = new Map<string, RateLimitState>();

const WINDOW_MS = 5 * 60 * 1000;
const BURST_THRESHOLD = 10;
const MIN_GAP_MS = 2_000;
const BACKOFF_BASE_MS = 15_000;
const BACKOFF_MAX_MS = 10 * 60 * 1000;
const QUIET_RESET_MS = 5 * 60 * 1000;

function getRateLimitKey(senderDid: string, interactionType: string): string {
  return `${senderDid}:${interactionType}`;
}

export function checkRateLimit(
  key: string,
  now = Date.now()
): { allowed: boolean; retryAfterMs?: number; reason?: string } {
  let state = rateLimitState.get(key);
  if (!state) {
    state = { timestamps: [], backoffLevel: 0, lastRequest: 0 };
    rateLimitState.set(key, state);
  }

  state.timestamps = state.timestamps.filter((t) => now - t < WINDOW_MS);

  if (state.lastRequest > 0 && now - state.lastRequest >= QUIET_RESET_MS) {
    if (state.backoffLevel > 0) {
      logger.info({ key, previousLevel: state.backoffLevel }, 'Rate limit backoff reset after quiet period');
    }
    state.backoffLevel = 0;
  }

  const sinceLastMs = now - state.lastRequest;
  if (state.lastRequest > 0 && sinceLastMs < MIN_GAP_MS) {
    return { allowed: false, retryAfterMs: MIN_GAP_MS - sinceLastMs, reason: 'min_gap' };
  }

  if (state.backoffLevel > 0) {
    const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, state.backoffLevel - 1), BACKOFF_MAX_MS);
    if (sinceLastMs < backoffMs) {
      return { allowed: false, retryAfterMs: backoffMs - sinceLastMs, reason: `backoff_level_${state.backoffLevel}` };
    }
  }

  if (state.timestamps.length >= BURST_THRESHOLD) {
    state.backoffLevel = Math.min(state.backoffLevel + 1, 6);
    const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, state.backoffLevel - 1), BACKOFF_MAX_MS);
    state.lastRequest = now;
    logger.warn({ key, level: state.backoffLevel, backoffMs, windowRequests: state.timestamps.length }, 'Rate limit backoff escalated');
    return { allowed: false, retryAfterMs: backoffMs, reason: `burst_exceeded_level_${state.backoffLevel}` };
  }

  state.timestamps.push(now);
  state.lastRequest = now;
  return { allowed: true };
}

// ─── Intent-specific handlers for bot replies ────────────────────────────────

async function handleProductFeedback(question: string, userId: bigint | null): Promise<string> {
  let category = 'suggestion';
  let summary = question;
  let clarification = "Could you tell me a bit more about what you'd like to see?";

  try {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `Extract product feedback from the user message. Reply with ONLY valid JSON:
{"category": "suggestion"|"bug"|"question"|"praise", "summary": "one-line summary", "clarification": "one follow-up question"}`,
      },
      { role: 'user', content: question },
    ];
    const result = await llm.complete(messages, { maxTokens: 200 });
    const parsed = JSON.parse(result.text.trim());
    if (parsed.category) category = parsed.category;
    if (parsed.summary) summary = parsed.summary;
    if (parsed.clarification) clarification = parsed.clarification;
  } catch (err) {
    logger.warn({ err }, 'Bot feedback extraction failed, using defaults');
  }

  if (userId) {
    await insertFeedback({ userId, category, summary, rawText: question });
  }

  return `Thank you for that feedback! 🙏 ${clarification} Either way, I've noted it for the team. Now — anything else I can help with?`;
}

function handleOffTopic(): string {
  return "I appreciate the message, but I'm focused on helping you discover and discuss news. Feel free to ask me about current events, trending stories, or news topics!";
}

function handleGreeting(): string {
  return "Hey there! 👋 I'm the open.news bot — ask me about the latest news, trending stories, or any topic you're curious about!";
}

// ─── Main bot reply job ──────────────────────────────────────────────────────

export async function botReplyJob(data: BotReplyJobData): Promise<void> {
  const { postUri, postCid, senderDid, text, interactionType, convoId } = data;

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
    // Classify intent before composing reply
    const intent = await classifyIntentHybrid(question);
    logger.info({ senderDid, interactionType, intent, question: question.slice(0, 80) }, 'Bot intent classified');

    let replyText: string;
    let llmProvider = 'static';
    const articlesUsed: bigint[] = [];

    if (intent === 'product_feedback') {
      replyText = await handleProductFeedback(question, user ? BigInt(user.id) : null);
    } else if (intent === 'off_topic') {
      replyText = handleOffTopic();
    } else if (intent === 'greeting') {
      replyText = handleGreeting();
    } else {
      // News-related intents: search, trending, or general news question
      const result = await composeBotReply({
        senderDid,
        question,
        interactionType,
        postUri,
        convoId,
      });
      replyText = result.text;
      llmProvider = result.llmProvider;
      articlesUsed.push(...result.articlesUsed);
    }

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

    logger.info({ senderDid, interactionType, intent, parts: parts.length }, 'Bot reply sent');
  } catch (err) {
    logger.error({ err, senderDid }, 'Bot reply failed');
    throw err;
  }
}

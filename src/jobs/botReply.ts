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

// In-memory rate limit store: senderDid → last reply timestamp
const lastReplyAt = new Map<string, number>();
const MENTION_USER_RATE_LIMIT_MS = 5 * 60 * 1000;       // 5 min for mention replies (users)
const MENTION_ANON_RATE_LIMIT_MS = 60 * 60 * 1000;      // 1 hr for mention replies (non-users)
const DM_RATE_LIMIT_MS = 10 * 1000;                       // 10s for DMs (conversational)

export async function botReplyJob(data: BotReplyJobData): Promise<void> {
  const { postUri, postCid, senderDid, text, interactionType, convoId } = data;

  // Strip @mention prefix from text
  const question = text.replace(/@[a-zA-Z0-9.-]+/g, '').trim();
  if (!question) return;

  const user = await getUserByDid(senderDid);

  // Rate limit: DMs are conversational (short cooldown), mentions are public (longer cooldown)
  const rateLimit = interactionType === 'dm'
    ? DM_RATE_LIMIT_MS
    : (user ? MENTION_USER_RATE_LIMIT_MS : MENTION_ANON_RATE_LIMIT_MS);
  const rateLimitKey = `${senderDid}:${interactionType}`;
  const lastAt = lastReplyAt.get(rateLimitKey) ?? 0;

  if (Date.now() - lastAt < rateLimit) {
    logger.info({ senderDid, interactionType, cooldownMs: rateLimit }, 'Bot reply rate-limited');
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

    lastReplyAt.set(rateLimitKey, Date.now());

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

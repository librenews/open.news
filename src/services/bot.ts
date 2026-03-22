import { llm, type LLMMessage } from './llm.js';
import { db } from '../db/client.js';
import { getContextArticlesForUser, getContextArticlesPopular } from '../db/queries/articles.js';
import { getUserByDid } from '../db/queries/users.js';
import { logger } from '../lib/logger.js';

export interface BotContext {
  senderDid: string;
  question: string;
  interactionType: 'mention' | 'dm';
  postUri?: string;
  convoId?: string;
}

interface ContextArticle {
  title: string | null;
  description: string | null;
  url: string;
  published_at: Date | null;
  text_excerpt: string | null;
}

interface RecentInteraction {
  input_text: string;
  response_text: string;
  created_at: Date;
}

function formatArticles(articles: ContextArticle[]): string {
  return articles
    .map((a, i) => {
      const date = a.published_at
        ? new Date(a.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      const excerpt = a.text_excerpt ? `\n   ${a.text_excerpt.slice(0, 400)}...` : '';
      return `${i + 1}. "${a.title ?? 'Untitled'}" — ${a.url}${date ? ` (${date})` : ''}${excerpt}`;
    })
    .join('\n\n');
}

/**
 * Get recent bot interactions with this sender (for conversation continuity).
 * Returns up to 5 recent exchanges, newest first.
 */
async function getRecentInteractions(senderDid: string, limit = 5): Promise<RecentInteraction[]> {
  const { rows } = await db.query<RecentInteraction>(
    `SELECT input_text, response_text, created_at
     FROM bot_interactions
     WHERE sender_did = $1 AND input_text IS NOT NULL AND response_text IS NOT NULL
     ORDER BY created_at DESC LIMIT $2`,
    [senderDid, limit]
  );
  return rows.reverse(); // chronological order
}

/**
 * Extract article titles already mentioned in recent interactions.
 */
function getAlreadyMentionedTitles(interactions: RecentInteraction[]): Set<string> {
  const titles = new Set<string>();
  for (const i of interactions) {
    // Match quoted article titles from bot responses like "Article Title"
    const matches = i.response_text.matchAll(/"([^"]{10,})"/g);
    for (const m of matches) {
      titles.add(m[1].toLowerCase());
    }
  }
  return titles;
}

/**
 * Build LLM messages and return a draft reply string.
 */
export async function composeBotReply(ctx: BotContext): Promise<{
  text: string;
  articlesUsed: bigint[];
  llmProvider: string;
}> {
  const user = await getUserByDid(ctx.senderDid);
  const articles = user
    ? await getContextArticlesForUser(user.id, ctx.question)
    : await getContextArticlesPopular(ctx.question);

  const articlesUsed: bigint[] = []; // TODO: track article IDs used

  // Get conversation history for context
  const recentInteractions = await getRecentInteractions(ctx.senderDid);
  const alreadyMentioned = getAlreadyMentionedTitles(recentInteractions);

  // Filter out articles we've already discussed
  const freshArticles = articles.filter(
    (a) => !a.title || !alreadyMentioned.has(a.title.toLowerCase())
  );
  const articlesToUse = freshArticles.length > 0 ? freshArticles : articles;

  // Build conversation history for LLM context
  const historyMessages: LLMMessage[] = recentInteractions.flatMap((i) => [
    { role: 'user' as const, content: i.input_text },
    { role: 'assistant' as const, content: i.response_text },
  ]);

  let systemPrompt: string;

  const conversationNote = recentInteractions.length > 0
    ? `\n\nYou have been chatting with this user recently. The conversation history is included. Do NOT repeat articles or stories you've already mentioned — find fresh angles, new details, or different stories. If you have nothing new to add, say so honestly.`
    : '';

  if (user && articlesToUse.length > 0) {
    systemPrompt = `You are the open.news assistant on Bluesky. You help users discover and discuss news from articles their network has shared.

The user @${user.handle} has articles shared by their network. Here are the most relevant ones for their question:

${formatArticles(articlesToUse)}

Answer their question using these articles as context. Be specific and cite article titles with their URLs so users can click through. If you don't have enough context, say so briefly.${conversationNote}

Keep replies concise — Bluesky posts have a 300 grapheme limit. Do not make up information not present in the articles. Do not suggest "checking your feed" or "checking your follows" — just answer with what you have.`;
  } else if (user) {
    systemPrompt = `You are the open.news assistant on Bluesky. You help users discover and discuss news from articles their network has shared.

The user @${user.handle} is registered but no articles matched their question. Let them know you don't have information on that topic right now, and suggest they try a different wording or topic.${conversationNote}

Keep replies concise — Bluesky posts have a 300 grapheme limit. Do not suggest "checking your feed" or "checking your follows."`;
  } else {
    systemPrompt = `You are the open.news assistant on Bluesky. You help people discover news from articles shared across the open.news network.

This person isn't a registered open.news user yet. Here are popular articles on this topic:

${formatArticles(articlesToUse)}

Answer helpfully and mention they can get personalized answers by signing up at open.news.${conversationNote}

Keep replies concise — Bluesky posts have a 300 grapheme limit. Do not make up information not present in the articles.`;
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...historyMessages,
    { role: 'user', content: ctx.question },
  ];

  const response = await llm.complete(messages, { maxTokens: 512 });

  logger.info({
    provider: response.provider,
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    senderDid: ctx.senderDid,
    interactionType: ctx.interactionType,
    freshArticles: freshArticles.length,
    totalArticles: articles.length,
    historyTurns: recentInteractions.length,
  }, 'LLM bot reply generated');

  return {
    text: response.text.trim(),
    articlesUsed,
    llmProvider: response.provider,
  };
}

/**
 * Split a long reply into ≤300 grapheme chunks for threaded posting.
 * Returns at most 3 segments.
 */
export function splitReply(text: string, maxParts = 3): string[] {
  const LIMIT = 290; // leave room for "1/3 " prefix

  if ([...text].length <= LIMIT) return [text];

  const sentences = text.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if ([...candidate].length <= LIMIT - 5) {
      current = candidate;
    } else {
      if (current) parts.push(current);
      current = sentence;
      if (parts.length >= maxParts - 1) break;
    }
  }
  if (current) parts.push(current);

  const total = Math.min(parts.length, maxParts);
  return parts.slice(0, total).map((p, i) =>
    total > 1 ? `${i + 1}/${total} ${p}` : p
  );
}

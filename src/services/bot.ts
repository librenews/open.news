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

  let systemPrompt: string;

  if (user && articles.length > 0) {
    systemPrompt = `You are the open.news assistant. You answer questions about news based on articles the user's network has shared on Bluesky.

The user @${user.handle} has articles in their reading history. Here are the most relevant ones for their question:

${formatArticles(articles)}

Answer their question using these articles as context. Be specific and cite article titles. If you don't have enough context to answer well, say so briefly and suggest they check their feed.

Keep replies concise — Bluesky posts have a 300 grapheme limit. If the answer requires more, note you can elaborate. Do not make up information not present in the articles.`;
  } else if (user) {
    systemPrompt = `You are the open.news assistant. You answer questions about news based on articles the user's network has shared on Bluesky.

The user @${user.handle} is registered, but no articles matched their question. Suggest they check their feed or rephrase, and note that open.news tracks news from their Bluesky follows.

Keep replies concise — Bluesky posts have a 300 grapheme limit.`;
  } else {
    systemPrompt = `You are the open.news assistant. You answer questions about news based on articles shared across the open.news network.

This person isn't a registered open.news user yet. Here are the most-read articles on this topic across the open.news network:

${formatArticles(articles)}

Answer helpfully, note this is based on network-wide popularity, and mention they can get personalized answers by signing up at open.news.

Keep replies concise — Bluesky posts have a 300 grapheme limit. Do not make up information not present in the articles.`;
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
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

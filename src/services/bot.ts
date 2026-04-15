import { llm, type LLMMessage } from './llm.js';
import { db } from '../db/client.js';
import { getContextArticlesForUser, getContextArticlesPopular, getArticlesMetaByIds } from '../db/queries/articles.js';
import { findSemanticArticlesContext } from '../db/queries/search.js';
import { embedText } from '../track/embedClient.js';
import { getUserByDid } from '../db/queries/users.js';
import { getPersona } from '../db/queries/preferences.js';
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
     WHERE sender_did = $1
       AND input_text IS NOT NULL AND response_text IS NOT NULL
       AND created_at > NOW() - INTERVAL '30 minutes'
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
  let articles: ContextArticle[] = [];
  
  // Try semantic search first
  try {
    const questionEmbedding = await embedText(ctx.question);
    const semanticChunks = await findSemanticArticlesContext(questionEmbedding, 5);
    
    if (semanticChunks.length > 0) {
      const articleIds = semanticChunks.map(c => c.article_id);
      const metaRows = await getArticlesMetaByIds(articleIds, user ? BigInt(user.id) : undefined);
      
      for (const chunk of semanticChunks) {
        const meta = metaRows.find(m => String(m.id) === chunk.article_id);
        if (meta) {
          articles.push({
            title: meta.title,
            description: meta.description,
            url: meta.url,
            published_at: meta.published_at,
            text_excerpt: chunk.text_content
          });
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Semantic context retrieval failed, falling back to FTS');
  }

  // Fallback to FTS if semantic lookup fails or yields nothing the user can see
  if (articles.length === 0) {
    articles = user
      ? await getContextArticlesForUser(user.id, ctx.question)
      : await getContextArticlesPopular(ctx.question);
  }

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
    ? `\n\nConversation history is included below for context. The user may be changing topics — always answer their CURRENT question. Use the history only to avoid repeating the same articles or information.`
    : '';

  // Fetch persona for registered users
  const persona = user ? await getPersona(BigInt(user.id)) : null;
  const personaNote = persona
    ? `\n\nUser profile: ${persona}\nUse this to prioritize topics and frame your responses to match their interests.`
    : '';

  if (user && articlesToUse.length > 0) {
    systemPrompt = `You are the open.news assistant on Bluesky. You help users discover and discuss news from articles their network has shared.

The user @${user.handle} has articles shared by their network. Here are the most relevant ones for their CURRENT question:

${formatArticles(articlesToUse)}

Answer their CURRENT question using these articles. Be specific and cite article titles with their URLs. If these articles don't relate to what they're asking, say you don't have information on that topic right now.${personaNote}${conversationNote}

Keep replies concise — Bluesky posts have a 300 grapheme limit. Do not make up information not in the articles. Do not suggest "checking your feed."`;
  } else if (user) {
    systemPrompt = `You are the open.news assistant on Bluesky. You help users discover and discuss news from articles their network has shared.

The user @${user.handle} is registered but no articles matched their CURRENT question. Let them know you don't have information on that specific topic right now.${personaNote}${conversationNote}

Keep replies concise — Bluesky posts have a 300 grapheme limit. Do not suggest "checking your feed." Do not reference topics from previous messages unless the user does.`;
  } else {
    systemPrompt = `You are the open.news assistant on Bluesky. You help people discover news from articles shared across the open.news network.

This person isn't a registered open.news user yet. Here are popular articles on their CURRENT topic:

${formatArticles(articlesToUse)}

Answer helpfully and mention they can get personalized answers by signing up at open.news.${conversationNote}

Keep replies concise — Bluesky posts have a 300 grapheme limit. Do not make up information not in the articles.`;
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

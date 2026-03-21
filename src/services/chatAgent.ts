import { logger } from '../lib/logger.js';
import { llm, type LLMMessage } from './llm.js';
import { classifyIntent } from './intentRouter.js';
import { sseRegistry } from '../web/sseRegistry.js';
import { braveSearch, type SearchResult } from './braveSearch.js';
import {
  getMessages,
  insertMessage,
  updateMessage,
} from '../db/queries/conversations.js';
import { getUserPreferences, upsertPreference } from '../db/queries/preferences.js';
import { getUserById } from '../db/queries/users.js';
import { db } from '../db/client.js';

/** Article context from FTS search. */
interface ArticleContext {
  id: number;
  title: string;
  description: string | null;
  url: string;
  published_at: Date | null;
  site_name: string | null;
  text_excerpt: string | null;
}

/** Search user's articles using PostgreSQL FTS. */
async function searchArticlesForUser(
  userId: number,
  query: string,
  limit = 5
): Promise<ArticleContext[]> {
  const { rows } = await db.query<ArticleContext>(
    `SELECT a.id, a.title, a.description, a.url, a.published_at, a.site_name,
            LEFT(a.full_text, 1500) AS text_excerpt
     FROM articles a
     JOIN user_articles ua ON ua.article_id = a.id
     CROSS JOIN plainto_tsquery('english', $1) query
     WHERE ua.user_id = $2
       AND a.is_news = TRUE
       AND a.search_vector @@ query
     ORDER BY ts_rank(a.search_vector, query) DESC, a.published_at DESC NULLS LAST
     LIMIT $3`,
    [query, userId, limit]
  );
  return rows;
}

/** Build the system prompt with user context, retrieved articles, and web search results. */
function buildSystemPrompt(
  handle: string,
  preferences: { type: string; value: string }[],
  articles: ArticleContext[],
  webResults?: SearchResult[]
): string {
  const prefLines = preferences.length > 0
    ? `\nActive preferences:\n${preferences.map(p => `- Do not include content from ${p.value}`).join('\n')}`
    : '';

  const articleLines = articles.length > 0
    ? `\nRelevant articles from their network:\n${articles.map(a =>
        `[${a.id}] "${a.title}" (${a.site_name ?? 'unknown'}, ${a.published_at ? new Date(a.published_at).toLocaleDateString() : 'no date'})\n${a.text_excerpt ?? a.description ?? ''}`
      ).join('\n\n')}`
    : '';

  const webLines = webResults && webResults.length > 0
    ? `\nWeb search results:\n${webResults.map((r, i) =>
        `[W${i + 1}] "${r.title}" (${r.site_name ?? r.url})${r.age ? ` — ${r.age}` : ''}\n${r.description}`
      ).join('\n\n')}`
    : '';

  const noContext = !articles.length && (!webResults || !webResults.length);

  return `You are the open.news assistant for @${handle}.
You answer questions about news based on articles their Bluesky network has shared.
When web search results are available, you may also use those to enrich your answers.
${prefLines}
${articleLines}
${webLines}
${noContext ? '\nNo relevant articles or search results found for this query.' : ''}

Answer using the provided context. Cite article titles when referencing network articles.
For web search results, provide the relevant information and include the URL so the user can visit the page.
Keep responses conversational. Do not fabricate information.

After your text response, you may emit structured content using these tags.
Emit them at the end, after your prose response, never inline.

To show articles from the user's network context, emit:
<articles heading="Top articles">1,4,7</articles>
(comma-separated article IDs from the provided context)

To show web search result links, emit:
<links heading="Search results">W1,W3</links>
(comma-separated web result IDs, e.g. W1, W2)

To suggest follow-up queries, emit:
<suggestions>Tell me more|Mute this topic|Find related</suggestions>

Do not emit these tags if they would not add value.`;
}

/** Parse structured blocks from LLM output. */
function parseBlocks(
  text: string,
  articles: ArticleContext[],
  webResults?: SearchResult[]
): { cleanText: string; blocks: unknown[] } {
  const blocks: unknown[] = [];
  let cleanText = text;

  // Parse <articles> tags
  const articlesMatch = text.match(/<articles heading="([^"]*)">([\d,\s]+)<\/articles>/);
  if (articlesMatch) {
    const heading = articlesMatch[1];
    const ids = articlesMatch[2].split(',').map(s => parseInt(s.trim(), 10));
    const matchedArticles = ids
      .map(id => articles.find(a => a.id === id))
      .filter(Boolean)
      .map(a => ({
        type: 'article_card' as const,
        article_id: a!.id,
        title: a!.title,
        url: a!.url,
        description: a!.description,
        image_url: null,
        site_name: a!.site_name,
        published_at: a!.published_at?.toISOString() ?? null,
      }));
    if (matchedArticles.length > 0) {
      blocks.push({ type: 'article_list', heading, articles: matchedArticles });
    }
    cleanText = cleanText.replace(/<articles[^>]*>[\s\S]*?<\/articles>/, '').trim();
  }

  // Parse <links> tags (web search results)
  const linksMatch = text.match(/<links heading="([^"]*)">([\w,\s]+)<\/links>/);
  if (linksMatch && webResults) {
    const heading = linksMatch[1];
    const ids = linksMatch[2].split(',').map(s => parseInt(s.trim().replace(/^W/i, ''), 10) - 1);
    const matchedLinks = ids
      .map(i => webResults[i])
      .filter(Boolean)
      .map(r => ({
        title: r.title,
        url: r.url,
        description: r.description,
        site_name: r.site_name,
      }));
    if (matchedLinks.length > 0) {
      blocks.push({ type: 'link_list', heading, links: matchedLinks });
    }
    cleanText = cleanText.replace(/<links[^>]*>[\s\S]*?<\/links>/, '').trim();
  }

  // Parse <suggestions> tags
  const suggestionsMatch = text.match(/<suggestions>(.*?)<\/suggestions>/);
  if (suggestionsMatch) {
    const suggestions = suggestionsMatch[1].split('|').map(s => s.trim()).filter(Boolean);
    if (suggestions.length > 0) {
      blocks.push({ type: 'suggestion', suggestions: suggestions.slice(0, 4) });
    }
    cleanText = cleanText.replace(/<suggestions>.*?<\/suggestions>/, '').trim();
  }

  return { cleanText, blocks };
}

/** Extract domain from text for mute commands. */
function extractDomainFromText(text: string): string | null {
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9][-a-z0-9]*\.[a-z]{2,}(?:\.[a-z]{2,})?)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Process a user message: classify intent, route to agent, stream response via SSE.
 * Runs inline in the web process (no worker needed for MVP).
 */
export async function processUserMessage(
  conversationId: number,
  userId: number,
  text: string
): Promise<void> {
  const intent = classifyIntent(text);
  logger.info({ conversationId, userId, intent }, 'Processing user message');

  const user = await getUserById(userId);
  if (!user) return;

  // ── Greeting ──────────────────────────────────────────────────────────────
  if (intent === 'greeting') {
    const msg = await insertMessage({
      conversationId,
      role: 'assistant',
      text: `Hey @${user.handle}! 👋 Ask me anything about the news your network is sharing.`,
      blocks: [{ type: 'suggestion', suggestions: ["What's trending?", 'Latest tech news', 'What did I miss today?'] }],
      agent: 'rag',
      intent: 'greeting',
      isComplete: true,
    });
    sseRegistry.push(userId, {
      event: 'message',
      data: { conversation_id: conversationId, message: { id: Number(msg.id), role: 'assistant', is_complete: true, text: msg.text } },
    });
    sseRegistry.push(userId, {
      event: 'blocks',
      data: { message_id: Number(msg.id), blocks: msg.blocks },
    });
    sseRegistry.push(userId, {
      event: 'done',
      data: { message_id: Number(msg.id), is_complete: true },
    });
    return;
  }

  // ── Mute domain ───────────────────────────────────────────────────────────
  if (intent === 'mute_domain') {
    const domain = extractDomainFromText(text);
    if (domain) {
      const msg = await insertMessage({
        conversationId,
        role: 'assistant',
        text: null,
        blocks: [{
          type: 'preference_confirm',
          preference_type: 'mute_domain',
          value: domain,
          message: `Got it — articles from ${domain} won't appear in your feed or be used as context.`,
        }, {
          type: 'suggestion',
          suggestions: ['Undo this', 'See my preferences', 'Mute another site'],
        }],
        agent: 'preferences',
        intent: 'mute_domain',
        isComplete: true,
      });
      await upsertPreference(userId, 'mute_domain', domain, msg.id);
      sseRegistry.push(userId, {
        event: 'message',
        data: { conversation_id: conversationId, message: { id: Number(msg.id), role: 'assistant', is_complete: true, text: '' } },
      });
      sseRegistry.push(userId, {
        event: 'blocks',
        data: { message_id: Number(msg.id), blocks: msg.blocks },
      });
      sseRegistry.push(userId, {
        event: 'done',
        data: { message_id: Number(msg.id), is_complete: true },
      });
    }
    return;
  }

  // ── RAG / Search / Article / Discovery — streamed LLM response ────────────
  const preferences = await getUserPreferences(userId);
  const articles = intent !== 'search' ? await searchArticlesForUser(userId, text) : [];

  // Web search: explicit search intent, or fallback when FTS returns no articles
  let webResults: SearchResult[] = [];
  if (intent === 'search' || (articles.length === 0 && (intent === 'news_question' || intent === 'discovery'))) {
    try {
      webResults = await braveSearch(text, { count: 5 });
      logger.info({ query: text, results: webResults.length }, 'Brave Search completed');
    } catch (err) {
      logger.warn({ err }, 'Brave Search failed, proceeding without web results');
    }
  }

  // Load recent conversation history (last 6 messages)
  const recentMessages = (await getMessages(conversationId, { limit: 6 })).reverse();

  const agentType = intent === 'search' ? 'search'
    : intent === 'discovery' ? 'discovery'
    : intent === 'article_explain' ? 'article' : 'rag';

  const llmMessages: LLMMessage[] = [
    { role: 'system', content: buildSystemPrompt(user.handle, preferences, articles, webResults) },
    ...recentMessages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.text || '' })),
    { role: 'user' as const, content: text },
  ];

  // Create placeholder assistant message
  const assistantMsg = await insertMessage({
    conversationId,
    role: 'assistant',
    text: '',
    agent: agentType,
    intent,
    articlesUsed: articles.map(a => BigInt(a.id)),
    isComplete: false,
  });

  const msgId = Number(assistantMsg.id);

  // Push initial message event
  sseRegistry.push(userId, {
    event: 'message',
    data: { conversation_id: conversationId, message: { id: msgId, role: 'assistant', is_complete: false, text: '' } },
  });

  // Stream LLM response
  let fullText = '';
  let llmProvider = '';
  try {
    for await (const chunk of llm.stream(llmMessages)) {
      if ('token' in chunk) {
        fullText += chunk.token;
        sseRegistry.push(userId, {
          event: 'token',
          data: { message_id: msgId, token: chunk.token },
        });
      } else {
        llmProvider = `${config.LLM_PROVIDER}/${config.LLM_MODEL}`;
        // Parse blocks from completed text
        const { cleanText, blocks } = parseBlocks(fullText, articles, webResults);
        await updateMessage(assistantMsg.id, {
          text: cleanText,
          blocks,
          isComplete: true,
          llmProvider,
        });

        // Send cleaned text (XML tags stripped) to replace raw streamed tokens
        sseRegistry.push(userId, {
          event: 'text_update',
          data: { message_id: msgId, text: cleanText },
        });

        if (blocks.length > 0) {
          sseRegistry.push(userId, {
            event: 'blocks',
            data: { message_id: msgId, blocks },
          });
        }

        sseRegistry.push(userId, {
          event: 'done',
          data: { message_id: msgId, is_complete: true },
        });
      }
    }
  } catch (err) {
    logger.error({ err, conversationId, msgId }, 'LLM streaming error');
    await updateMessage(assistantMsg.id, {
      text: "I'm having trouble connecting to my language model right now. Please try again in a moment.",
      isComplete: true,
    });
    sseRegistry.push(userId, {
      event: 'token',
      data: { message_id: msgId, token: "I'm having trouble connecting to my language model right now. Please try again in a moment." },
    });
    sseRegistry.push(userId, {
      event: 'done',
      data: { message_id: msgId, is_complete: true },
    });
  }
}

// Re-export config for use in the streaming loop
import { config } from '../lib/config.js';

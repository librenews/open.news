import { llm, type LLMMessage } from './llm.js';
import { logger } from '../lib/logger.js';

export type Intent =
  | 'news_question'
  | 'search'
  | 'mute_domain'
  | 'mute_source'
  | 'topic_filter'
  | 'article_explain'
  | 'discovery'
  | 'greeting'
  | 'product_feedback'
  | 'unknown';

// ─── Regex shortcuts for obvious patterns ────────────────────────────────────

const REGEX_INTENTS: [RegExp, Intent][] = [
  [/don'?t (show|include|use).*(site|domain|source)/i, 'mute_domain'],
  [/mute|block|hide|exclude/i, 'mute_domain'],
  [/only show|filter to|just (show|give)/i, 'topic_filter'],
  [/^h(i|ello|ey)\b/i, 'greeting'],
  [/^(thanks|thank you|ty)\b/i, 'greeting'],
  [/trending|popular|what'?s hot/i, 'discovery'],
  [/tell me more about (this|that) article/i, 'article_explain'],
  [/summarize|explain|break down/i, 'article_explain'],
  [/search (for|the|about)?|look(ing)? up|find me|google|where (can|do) I|how (do|can) I (register|sign up|get|buy|find)/i, 'search'],
  [/feature request|i wish|would be (nice|great|cool)|suggestion:|can you add|you should add|please add|it would help|bug report/i, 'product_feedback'],
];

/** Fast regex-only classification (always synchronous). */
export function classifyIntent(text: string): Intent {
  for (const [regex, intent] of REGEX_INTENTS) {
    if (regex.test(text)) return intent;
  }
  return 'news_question';
}

// ─── LLM fallback classifier ─────────────────────────────────────────────────

const VALID_INTENTS = new Set<Intent>([
  'news_question', 'search', 'mute_domain', 'mute_source',
  'topic_filter', 'article_explain', 'discovery', 'greeting',
  'product_feedback',
]);

const CLASSIFY_SYSTEM_PROMPT = `You are an intent classifier for a news assistant chatbot.
Classify the user's message into exactly one intent. Reply with ONLY the intent name, nothing else.

Intents:
- greeting: casual hello, thanks, hi, hey
- news_question: asking about news, current events, what happened, updates on a topic
- search: explicitly wants to search the web, find a link, look something up, find registration/tickets/etc.
- discovery: wants to see trending/popular/top stories
- mute_domain: wants to hide/block/stop seeing articles from a site or domain
- mute_source: wants to mute a specific person/account
- topic_filter: wants to only see specific topics
- article_explain: wants a deeper explanation or summary of a specific article
- product_feedback: feedback about this product (feature requests, suggestions, bug reports, complaints, praise, questions about how the app works)

Examples:
"what's going on with Ukraine?" → news_question
"can you find me registration info for ATmosphere?" → search
"I don't want to see CNN anymore" → mute_domain
"hey!" → greeting
"what are people talking about?" → discovery
"stop showing me posts from that account" → mute_source
"I wish I could filter by topic" → product_feedback
"this app is great!" → product_feedback
"why doesn't the search work better?" → product_feedback
"can you add dark mode?" → product_feedback`;

/**
 * Hybrid intent classification: regex-first, LLM-fallback.
 * If regex matches a specific intent, returns immediately.
 * If regex falls through to default (news_question), calls the LLM
 * for a more nuanced classification.
 */
export async function classifyIntentHybrid(text: string): Promise<Intent> {
  // 1. Try regex first
  const regexResult = classifyIntent(text);
  if (regexResult !== 'news_question') {
    return regexResult;
  }

  // 2. Regex returned default — ask the LLM
  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
      { role: 'user', content: text },
    ];
    const response = await llm.complete(messages, { maxTokens: 20 });
    const classified = response.text.trim().toLowerCase() as Intent;

    if (VALID_INTENTS.has(classified)) {
      logger.debug({ text, regexIntent: 'news_question', llmIntent: classified }, 'LLM intent classification');
      return classified;
    }

    logger.warn({ text, llmResponse: response.text }, 'LLM returned invalid intent, falling back to news_question');
    return 'news_question';
  } catch (err) {
    logger.warn({ err }, 'LLM intent classification failed, falling back to regex result');
    return 'news_question';
  }
}

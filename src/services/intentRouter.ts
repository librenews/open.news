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
  | 'off_topic';

// ─── Regex shortcuts for trivially harmless patterns ─────────────────────────
// These skip the LLM entirely — no guardrail needed for "hi" or "thanks".

const GREETING_REGEX = [
  /^h(i|ello|ey)\b/i,
  /^(thanks|thank you|ty)\b/i,
  /^(good\s)?(morning|afternoon|evening)\b/i,
  /^(yo|sup|howdy)\b/i,
];

/** Fast regex-only classification (sync, exported for tests). */
export function classifyIntent(text: string): Intent | null {
  for (const regex of GREETING_REGEX) {
    if (regex.test(text.trim())) return 'greeting';
  }
  return null; // Not a greeting → needs LLM classification
}

// ─── LLM-powered intent classification with prime directive ──────────────────

const VALID_INTENTS = new Set<Intent>([
  'news_question', 'search', 'mute_domain', 'mute_source',
  'topic_filter', 'article_explain', 'discovery', 'greeting',
  'product_feedback', 'off_topic',
]);

const CLASSIFY_SYSTEM_PROMPT = `You are the intent classifier for open.news, a news assistant that surfaces the best news for its users from their Bluesky social network.

PRIME DIRECTIVE: open.news exists ONLY to help users discover, read, and discuss news. Any request that falls outside this core mission must be classified as "off_topic". You do not generate creative content, write code, manipulate images, produce adult content, or do anything unrelated to news.

Classify the user's message into exactly ONE intent. Reply with ONLY the intent name, nothing else.

Available intents:
- greeting: casual hello, thanks, hi, hey
- news_question: asking about news, current events, what happened, updates on a topic
- search: wants to search the web for information, find a link, look something up
- discovery: wants trending/popular/top stories, what people are talking about
- mute_domain: wants to hide/block/stop seeing articles from a specific site or domain
- mute_source: wants to mute a specific person/account
- topic_filter: wants to only see specific topics or categories
- article_explain: wants a deeper explanation or summary of a specific article
- product_feedback: feedback about this product — feature requests, suggestions, bug reports, praise, questions about how the app works
- off_topic: ANYTHING that is not about news, not about managing their news experience, and not about this product. This includes: creative writing, coding help, image generation, adult content, personal advice, math homework, general knowledge questions unrelated to current events, etc.

Examples:
"what's going on with Ukraine?" → news_question
"search for climate conference registration" → search
"I don't want to see CNN anymore" → mute_domain
"what are people talking about?" → discovery
"tell me more about that article" → article_explain
"I wish I could filter by topic" → product_feedback
"write me a poem" → off_topic
"what's 2+2?" → off_topic
"generate an image of a cat" → off_topic
"help me with my Python code" → off_topic`;

/**
 * Classify intent using LLM with prime directive.
 * Regex catches trivial greetings; everything else goes through one LLM call
 * that enforces the core mission and classifies intent simultaneously.
 */
export async function classifyIntentHybrid(text: string): Promise<Intent> {
  // 1. Regex shortcut for greetings (zero latency, no guardrail needed)
  const regexResult = classifyIntent(text);
  if (regexResult) return regexResult;

  // 2. Single LLM call: guardrails + classification in one prompt
  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
      { role: 'user', content: text },
    ];
    const response = await llm.complete(messages, { maxTokens: 20 });
    const classified = response.text.trim().toLowerCase() as Intent;

    if (VALID_INTENTS.has(classified)) {
      logger.debug({ text: text.slice(0, 80), intent: classified }, 'LLM intent classification');
      return classified;
    }

    logger.warn({ text: text.slice(0, 80), llmResponse: response.text }, 'LLM returned invalid intent, defaulting to news_question');
    return 'news_question';
  } catch (err) {
    logger.warn({ err }, 'LLM intent classification failed, defaulting to news_question');
    return 'news_question';
  }
}

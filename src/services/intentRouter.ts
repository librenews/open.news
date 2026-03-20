export type Intent =
  | 'news_question'
  | 'mute_domain'
  | 'mute_source'
  | 'topic_filter'
  | 'article_explain'
  | 'discovery'
  | 'greeting'
  | 'unknown';

const REGEX_INTENTS: [RegExp, Intent][] = [
  [/don'?t (show|include|use).*(site|domain|source)/i, 'mute_domain'],
  [/mute|block|hide|exclude/i, 'mute_domain'],
  [/only show|filter to|just (show|give)/i, 'topic_filter'],
  [/^h(i|ello|ey)\b/i, 'greeting'],
  [/^(thanks|thank you|ty)\b/i, 'greeting'],
  [/trending|popular|what'?s hot/i, 'discovery'],
  [/tell me more about (this|that) article/i, 'article_explain'],
  [/summarize|explain|break down/i, 'article_explain'],
];

/** Classify intent from user text using regex shortcuts. */
export function classifyIntent(text: string): Intent {
  for (const [regex, intent] of REGEX_INTENTS) {
    if (regex.test(text)) return intent;
  }
  // Default: treat as a news question (the RAG agent handles everything else)
  return 'news_question';
}

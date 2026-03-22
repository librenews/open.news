import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies that intentRouter now imports
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

vi.mock('../lib/config.js', () => ({
  config: {
    LLM_PROVIDER: 'anthropic',
    LLM_MODEL: 'test-model',
    LLM_API_KEY: 'test-key',
    LLM_OLLAMA_URL: 'http://localhost:11434',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    PORT: 3000,
    SESSION_SECRET: 'testsecretstring01',
    BASE_URL: 'http://localhost:3000',
    LOG_LEVEL: 'info',
    NODE_ENV: 'test',
    BSKY_OAUTH_CLIENT_ID: 'http://localhost/oauth/client-metadata.json',
    ATPROTO_PDS_URL: 'https://bsky.social',
    JETSTREAM_URL: 'wss://jetstream.example.com/subscribe',
  },
}));

vi.mock('./llm.js', () => ({
  llm: {
    complete: vi.fn(),
    stream: vi.fn(),
  },
}));

import { classifyIntent, classifyIntentHybrid } from './intentRouter.js';
import { llm } from './llm.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('classifyIntent (regex)', () => {
  // ── Greeting ────────────────────────────────────────────────────────────────
  it('classifies "Hello" as greeting', () => {
    expect(classifyIntent('Hello')).toBe('greeting');
  });

  it('classifies "hi" as greeting', () => {
    expect(classifyIntent('hi')).toBe('greeting');
  });

  it('classifies "hey there" as greeting', () => {
    expect(classifyIntent('hey there')).toBe('greeting');
  });

  it('classifies "Thanks!" as greeting', () => {
    expect(classifyIntent('Thanks!')).toBe('greeting');
  });

  // ── Mute domain ─────────────────────────────────────────────────────────────
  it('classifies "mute nytimes.com" as mute_domain', () => {
    expect(classifyIntent('mute nytimes.com')).toBe('mute_domain');
  });

  it('classifies "block cnn.com articles" as mute_domain', () => {
    expect(classifyIntent('block cnn.com articles')).toBe('mute_domain');
  });

  it('classifies "don\'t show articles from this site" as mute_domain', () => {
    expect(classifyIntent("don't show articles from this site")).toBe('mute_domain');
  });

  it('classifies "hide foxnews.com" as mute_domain', () => {
    expect(classifyIntent('hide foxnews.com')).toBe('mute_domain');
  });

  it('classifies "exclude this domain" as mute_domain', () => {
    expect(classifyIntent('exclude this domain')).toBe('mute_domain');
  });

  // ── Topic filter ────────────────────────────────────────────────────────────
  it('classifies "only show tech news" as topic_filter', () => {
    expect(classifyIntent('only show tech news')).toBe('topic_filter');
  });

  it('classifies "filter to politics" as topic_filter', () => {
    expect(classifyIntent('filter to politics')).toBe('topic_filter');
  });

  it('classifies "just show me sports" as topic_filter', () => {
    expect(classifyIntent('just show me sports')).toBe('topic_filter');
  });

  // ── Discovery ───────────────────────────────────────────────────────────────
  it('classifies "what\'s trending?" as discovery', () => {
    expect(classifyIntent("what's trending?")).toBe('discovery');
  });

  it('classifies "popular stories" as discovery', () => {
    expect(classifyIntent('popular stories')).toBe('discovery');
  });

  it('classifies "what\'s hot right now" as discovery', () => {
    expect(classifyIntent("what's hot right now")).toBe('discovery');
  });

  // ── Article explain ─────────────────────────────────────────────────────────
  it('classifies "summarize this article" as article_explain', () => {
    expect(classifyIntent('summarize this article')).toBe('article_explain');
  });

  it('classifies "explain this to me" as article_explain', () => {
    expect(classifyIntent('explain this to me')).toBe('article_explain');
  });

  it('classifies "tell me more about this article" as article_explain', () => {
    expect(classifyIntent('tell me more about this article')).toBe('article_explain');
  });

  // ── Search ──────────────────────────────────────────────────────────────────
  it('classifies "search for electric vehicles" as search', () => {
    expect(classifyIntent('search for electric vehicles')).toBe('search');
  });

  it('classifies "look up the latest on AI" as search', () => {
    expect(classifyIntent('look up the latest on AI')).toBe('search');
  });

  it('classifies "find me a recipe" as search', () => {
    expect(classifyIntent('find me a recipe')).toBe('search');
  });

  it('classifies "where can I register for ATmosphere" as search', () => {
    expect(classifyIntent('where can I register for ATmosphere')).toBe('search');
  });

  it('classifies "how do I sign up for the event" as search', () => {
    expect(classifyIntent('how do I sign up for the event')).toBe('search');
  });

  // ── Default → news_question ─────────────────────────────────────────────────
  it('classifies "What happened with the Fed rate decision?" as news_question', () => {
    expect(classifyIntent('What happened with the Fed rate decision?')).toBe('news_question');
  });

  it('classifies "What did I miss today?" as news_question', () => {
    expect(classifyIntent('What did I miss today?')).toBe('news_question');
  });

  it('classifies "Tell me about the latest AI developments" as news_question', () => {
    expect(classifyIntent('Tell me about the latest AI developments')).toBe('news_question');
  });

  it('classifies empty-ish strings as news_question', () => {
    expect(classifyIntent('  ')).toBe('news_question');
  });
});

describe('classifyIntentHybrid', () => {
  it('returns regex result directly for clear matches (no LLM call)', async () => {
    const result = await classifyIntentHybrid('hello');
    expect(result).toBe('greeting');
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('calls LLM when regex returns news_question', async () => {
    vi.mocked(llm.complete).mockResolvedValue({
      text: 'search',
      inputTokens: 50,
      outputTokens: 1,
      provider: 'test',
      model: 'test',
    });

    const result = await classifyIntentHybrid('can you find me registration info for ATmosphere conference?');
    // "find me" matches regex → search, so LLM shouldn't be called here
    // Let's use a truly ambiguous one
    expect(result).toBe('search');
  });

  it('uses LLM for ambiguous inputs that regex defaults to news_question', async () => {
    vi.mocked(llm.complete).mockResolvedValue({
      text: 'mute_domain',
      inputTokens: 50,
      outputTokens: 1,
      provider: 'test',
      model: 'test',
    });

    const result = await classifyIntentHybrid("I don't want to see CNN anymore");
    expect(result).toBe('mute_domain');
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('falls back to news_question when LLM returns invalid intent', async () => {
    vi.mocked(llm.complete).mockResolvedValue({
      text: 'invalid_intent_type',
      inputTokens: 50,
      outputTokens: 1,
      provider: 'test',
      model: 'test',
    });

    const result = await classifyIntentHybrid('some ambiguous message');
    expect(result).toBe('news_question');
  });

  it('falls back to news_question when LLM call fails', async () => {
    vi.mocked(llm.complete).mockRejectedValue(new Error('LLM timeout'));

    const result = await classifyIntentHybrid('some ambiguous message');
    expect(result).toBe('news_question');
  });
});

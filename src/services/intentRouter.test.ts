import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
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

// ─── Regex-only (classifyIntent) ─────────────────────────────────────────────

describe('classifyIntent (regex — greetings only)', () => {
  it.each([
    ['Hello', 'greeting'],
    ['hi', 'greeting'],
    ['hey there', 'greeting'],
    ['Thanks!', 'greeting'],
    ['thank you', 'greeting'],
    ['good morning', 'greeting'],
    ['yo', 'greeting'],
  ])('classifies "%s" as %s', (text, expected) => {
    expect(classifyIntent(text)).toBe(expected);
  });

  it.each([
    'What happened with Ukraine?',
    'search for electric vehicles',
    'mute cnn.com',
    'I wish I could filter by topic',
    'write me a poem',
    '  ',
  ])('returns null for non-greeting: "%s"', (text) => {
    expect(classifyIntent(text)).toBeNull();
  });
});

// ─── Hybrid (classifyIntentHybrid) ───────────────────────────────────────────

describe('classifyIntentHybrid', () => {
  const mockLLMResponse = (intent: string) => {
    vi.mocked(llm.complete).mockResolvedValue({
      text: intent,
      inputTokens: 50,
      outputTokens: 1,
      provider: 'test',
      model: 'test',
    });
  };

  it('returns greeting via regex without LLM call', async () => {
    const result = await classifyIntentHybrid('hello');
    expect(result).toBe('greeting');
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('calls LLM for news questions', async () => {
    mockLLMResponse('news_question');
    const result = await classifyIntentHybrid('What is happening in Ukraine?');
    expect(result).toBe('news_question');
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('classifies search via LLM', async () => {
    mockLLMResponse('search');
    const result = await classifyIntentHybrid('find me registration for ATmosphere');
    expect(result).toBe('search');
  });

  it('classifies mute_domain via LLM', async () => {
    mockLLMResponse('mute_domain');
    const result = await classifyIntentHybrid("I don't want to see CNN anymore");
    expect(result).toBe('mute_domain');
  });

  it('classifies product_feedback via LLM', async () => {
    mockLLMResponse('product_feedback');
    const result = await classifyIntentHybrid('I wish I could filter by topic');
    expect(result).toBe('product_feedback');
  });

  it('classifies off_topic via LLM (prime directive)', async () => {
    mockLLMResponse('off_topic');
    const result = await classifyIntentHybrid('write me a poem about cats');
    expect(result).toBe('off_topic');
  });

  it('classifies discovery via LLM', async () => {
    mockLLMResponse('discovery');
    const result = await classifyIntentHybrid('what are people talking about?');
    expect(result).toBe('discovery');
  });

  it('falls back to news_question for invalid LLM response', async () => {
    mockLLMResponse('invalid_garbage');
    const result = await classifyIntentHybrid('some message');
    expect(result).toBe('news_question');
  });

  it('falls back to news_question when LLM fails', async () => {
    vi.mocked(llm.complete).mockRejectedValue(new Error('LLM timeout'));
    const result = await classifyIntentHybrid('some message');
    expect(result).toBe('news_question');
  });
});

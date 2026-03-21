import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing chatAgent
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

vi.mock('../lib/config.js', () => ({
  config: {
    LLM_PROVIDER: 'anthropic',
    LLM_MODEL: 'test-model',
    LLM_API_KEY: 'test-key',
    LLM_OLLAMA_URL: 'http://localhost:11434',
    BRAVE_API_KEY: undefined,
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

vi.mock('../web/sseRegistry.js', () => ({
  sseRegistry: {
    push: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    hasStreams: vi.fn(),
  },
}));

vi.mock('../db/queries/conversations.js', () => ({
  getMessages: vi.fn(),
  insertMessage: vi.fn(),
  updateMessage: vi.fn(),
}));

vi.mock('../db/queries/preferences.js', () => ({
  getUserPreferences: vi.fn(),
  upsertPreference: vi.fn(),
}));

vi.mock('../db/queries/users.js', () => ({
  getUserById: vi.fn(),
}));

vi.mock('../db/client.js', () => ({
  db: { query: vi.fn() },
}));

import { processUserMessage } from './chatAgent.js';
import { sseRegistry } from '../web/sseRegistry.js';
import { insertMessage, getMessages, updateMessage } from '../db/queries/conversations.js';
import { getUserPreferences, upsertPreference } from '../db/queries/preferences.js';
import { getUserById } from '../db/queries/users.js';
import { llm } from './llm.js';
import { db } from '../db/client.js';

const mockUser = { id: BigInt(1), did: 'did:plc:test', handle: 'test.bsky.social', display_name: 'Test', avatar_url: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserById).mockResolvedValue(mockUser as never);
  vi.mocked(insertMessage).mockImplementation(async (params: { conversationId: unknown }) => ({
    id: BigInt(100),
    conversation_id: BigInt(params.conversationId as number),
    user_id: null,
    role: 'assistant',
    text: '',
    blocks: [],
    agent: null,
    intent: null,
    articles_used: null,
    llm_provider: null,
    external_uri: null,
    is_complete: false,
    created_at: new Date(),
  }));
});

describe('processUserMessage', () => {
  // ── Greeting ────────────────────────────────────────────────────────────────
  it('handles greeting without LLM call', async () => {
    await processUserMessage(1, 1, 'Hello');

    // Should NOT call LLM
    expect(llm.stream).not.toHaveBeenCalled();
    expect(llm.complete).not.toHaveBeenCalled();

    // Should insert a greeting message
    expect(insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 1,
        role: 'assistant',
        intent: 'greeting',
        isComplete: true,
      })
    );

    // Should push SSE events: message, blocks, done
    expect(sseRegistry.push).toHaveBeenCalledTimes(3);
    expect(vi.mocked(sseRegistry.push).mock.calls[0][1]).toMatchObject({ event: 'message' });
    expect(vi.mocked(sseRegistry.push).mock.calls[1][1]).toMatchObject({ event: 'blocks' });
    expect(vi.mocked(sseRegistry.push).mock.calls[2][1]).toMatchObject({ event: 'done' });
  });

  it('greeting includes suggestion chips', async () => {
    await processUserMessage(1, 1, 'hey');

    const insertCall = vi.mocked(insertMessage).mock.calls[0][0] as { blocks: unknown[] };
    const suggestions = insertCall.blocks as { type: string; suggestions?: string[] }[];
    expect(suggestions).toContainEqual(
      expect.objectContaining({ type: 'suggestion', suggestions: expect.any(Array) })
    );
  });

  // ── Mute domain ─────────────────────────────────────────────────────────────
  it('handles mute domain command without LLM', async () => {
    await processUserMessage(1, 1, 'mute nytimes.com');

    expect(llm.stream).not.toHaveBeenCalled();
    expect(upsertPreference).toHaveBeenCalledWith(1, 'mute_domain', 'nytimes.com', BigInt(100));
    expect(insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'preferences',
        intent: 'mute_domain',
      })
    );
  });

  it('mute domain extracts domain from "block washingtonpost.com articles"', async () => {
    await processUserMessage(1, 1, 'block washingtonpost.com articles');

    expect(upsertPreference).toHaveBeenCalledWith(1, 'mute_domain', 'washingtonpost.com', BigInt(100));
  });

  // ── RAG agent (LLM streaming) ──────────────────────────────────────────────
  it('routes news questions to LLM streaming', async () => {
    vi.mocked(getUserPreferences).mockResolvedValue([]);
    vi.mocked(getMessages).mockResolvedValue([]);
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] } as never);

    // Mock streaming with an async generator
    async function* mockStream() {
      yield { token: 'The ' };
      yield { token: 'Fed ' };
      yield { token: 'held rates.' };
      yield { done: true as const, usage: { input: 100, output: 20 } };
    }
    vi.mocked(llm.stream).mockReturnValue(mockStream());

    await processUserMessage(1, 1, 'What happened with the Fed?');

    // Should call LLM stream
    expect(llm.stream).toHaveBeenCalledTimes(1);

    // Should push SSE token events (transparency prefix + 3 LLM tokens)
    const pushCalls = vi.mocked(sseRegistry.push).mock.calls;
    const tokenEvents = pushCalls.filter(call => (call[1] as { event: string }).event === 'token');
    expect(tokenEvents.length).toBe(4); // transparency prefix + 'The ', 'Fed ', 'held rates.'

    // Should finalize message
    expect(updateMessage).toHaveBeenCalledWith(
      BigInt(100),
      expect.objectContaining({ isComplete: true })
    );
  });

  it('handles LLM streaming error gracefully', async () => {
    vi.mocked(getUserPreferences).mockResolvedValue([]);
    vi.mocked(getMessages).mockResolvedValue([]);
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] } as never);

    // Mock stream that throws
    async function* errorStream() {
      yield { token: 'Starting...' };
      throw new Error('Connection reset');
    }
    vi.mocked(llm.stream).mockReturnValue(errorStream() as never);

    await processUserMessage(1, 1, 'What is happening?');

    // Should update message with error text
    expect(updateMessage).toHaveBeenCalledWith(
      BigInt(100),
      expect.objectContaining({
        text: expect.stringContaining('trouble connecting'),
        isComplete: true,
      })
    );

    // Should still push done event
    const pushCalls = vi.mocked(sseRegistry.push).mock.calls;
    const doneEvents = pushCalls.filter(call => (call[1] as { event: string }).event === 'done');
    expect(doneEvents.length).toBe(1);
  });

  it('returns early if user not found', async () => {
    vi.mocked(getUserById).mockResolvedValue(null as never);

    await processUserMessage(1, 999, 'Hello');

    expect(insertMessage).not.toHaveBeenCalled();
    expect(sseRegistry.push).not.toHaveBeenCalled();
  });
});

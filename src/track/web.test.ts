import { describe, it, expect, vi, beforeEach } from 'vitest';
import { app } from './web.js';
import { createHmac } from 'crypto';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockCreateTrack, mockUpdateTrack, mockGetTrackByUuid, mockUpsertTrackQuery, mockUpdateTrackKeywords } = vi.hoisted(() => ({
  mockCreateTrack: vi.fn(() => ({ id: 1, uuid: 'test-uuid' })),
  mockUpdateTrack: vi.fn(),
  mockGetTrackByUuid: vi.fn(),
  mockUpsertTrackQuery: vi.fn(),
  mockUpdateTrackKeywords: vi.fn(),
}));

vi.mock('../db/queries/tracks.js', () => ({
  createTrack: mockCreateTrack,
  updateTrack: mockUpdateTrack,
  updateTrackKeywords: mockUpdateTrackKeywords,
  getTrackByUuid: mockGetTrackByUuid,
  getTracksByUserId: vi.fn(() => []),
  getMatchesByUserId: vi.fn(),
  getMatchCountByTrack: vi.fn(() => new Map()),
}));

vi.mock('./opensearch.js', () => ({
  upsertTrackQuery: mockUpsertTrackQuery,
  deleteTrackQuery: vi.fn(),
}));

vi.mock('./embedClient.js', () => ({
  embedText: vi.fn(() => Array(768).fill(0)),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('API Abuse Protection', () => {
  const userId = 12345n;
  let authCookie: string;

  beforeEach(() => {
    vi.clearAllMocks();

    const payload = String(userId);
    const secret = process.env.SESSION_SECRET ?? 'dev-secret';
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    authCookie = `track_session=${payload}.${sig}`;
  });

  const postForm = async (url: string, data: Record<string, string>) => {
    const formData = new FormData();
    for (const [k, v] of Object.entries(data)) formData.append(k, v);
    const req = new Request(`http://localhost${url}`, {
      method: 'POST',
      body: formData,
      headers: { Cookie: authCookie },
    });
    return app.request(req);
  };

  it('handles excessively long strings gracefully', async () => {
    const res = await postForm('/tracks', {
      name: 'A'.repeat(100_000),
      query: 'B'.repeat(100_000),
      keywords: 'C'.repeat(100_000),
      threshold: '0.5',
    });

    expect(res.status).toBe(302);
    expect(mockCreateTrack).toHaveBeenCalledOnce();
    
    // Check parameters passed to DB: (userId, name, keywords, osQueryId, query, threshold, semanticEmbedding)
    const [, name, keywords, , query] = mockCreateTrack.mock.calls[0] as any[];
    
    expect(name.length).toBe(75);
    expect(query?.length).toBe(600);
    expect(keywords.length).toBe(1);
    expect(keywords[0].length).toBe(100);
  });

  it('handles missing or garbage threshold types', async () => {
    const res = await postForm('/tracks', {
      name: 'Garbage Threshold',
      query: 'a valid query',
      threshold: 'DROP TABLE tracks;',
    });

    expect(res.status).toBe(302);
    expect(mockCreateTrack).toHaveBeenCalledOnce();
    
    const [, , , , , threshold] = mockCreateTrack.mock.calls[0] as any[];
    expect(Number.isNaN(threshold)).toBe(false);
    expect(threshold).toBe(0.75); // Fallback float coercion
  });

  it('limits massive arrays of keywords to 5', async () => {
    const words = Array.from({length: 1000}, (_, i) => `word${i}`).join(',');
    const res = await postForm('/tracks', {
      name: 'Many Keywords',
      keywords: words,
    });

    expect(res.status).toBe(302);
    expect(mockCreateTrack).toHaveBeenCalledOnce();

    const [, , keywords] = mockCreateTrack.mock.calls[0] as any[];
    expect(keywords.length).toBe(5);
    expect(keywords).toEqual(['word0', 'word1', 'word2', 'word3', 'word4']);
  });

  it('handles unicode, non-english, and emojis safely', async () => {
    const name = 'T̸̮͒̓H̷̘͛I̸͉͝S̵͕̒ ̶͇̇I̸͙̚S̸̲̏ ̴̤͒F̵͕̒I̵͉͝N̵͕̒E̵͉͝ 🌪️🔥🧊';
    const query = '日本語で話し、韓国語で歌う 🙏🏽';
    
    const res = await postForm('/tracks', { name, query });

    expect(res.status).toBe(302);
    expect(mockCreateTrack).toHaveBeenCalledOnce();

    const [, dbName, , , dbQuery] = mockCreateTrack.mock.calls[0] as any[];
    expect(dbName).toBe(name);
    expect(dbQuery).toBe(query);
  });
});

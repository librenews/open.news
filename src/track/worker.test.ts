import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../lib/config.js', () => ({
  config: { REDIS_URL: 'redis://localhost:6379', OPENSEARCH_URL: 'https://localhost:9200' },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const mockGetTracksWithEmbeddings = vi.fn();
vi.mock('../db/queries/tracks.js', () => ({
  getTracksWithEmbeddings: (...args: unknown[]) => mockGetTracksWithEmbeddings(...args),
  insertTrackMatch: vi.fn(),
}));

const mockPercolatePost = vi.fn();
vi.mock('./opensearch.js', () => ({
  ensureIndex: vi.fn(),
  percolatePost: (...args: unknown[]) => mockPercolatePost(...args),
}));

vi.mock('./embedClient.js', () => ({
  embedTexts: vi.fn(),
  checkEmbedHealth: vi.fn(),
}));

import { matchPost, cosineSimilarity, resetTrackCache } from './worker.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a simple unit vector for testing (all same values, normalized). */
function makeEmbedding(dims: number, value = 1): number[] {
  const mag = Math.sqrt(dims * value * value);
  return Array(dims).fill(value / mag);
}

/** Create a perpendicular embedding (all zeros except one dimension). */
function makeOrthogonalEmbedding(dims: number): number[] {
  const vec = Array(dims).fill(0);
  vec[0] = 1;
  return vec;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical normalized vectors', () => {
    const a = makeEmbedding(3);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1.0);
  });

  it('returns ~0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1);
  });
});

describe('matchPost', () => {
  const fakeEmbedding = makeEmbedding(4);
  const similarEmbedding = makeEmbedding(4); // identical → cos sim ≈ 1.0
  const dissimilarEmbedding = makeOrthogonalEmbedding(4); // cos sim ≈ 0

  beforeEach(() => {
    vi.restoreAllMocks();
    resetTrackCache();
    mockPercolatePost.mockResolvedValue([]);
    mockGetTracksWithEmbeddings.mockResolvedValue([]);
  });

  // ─── Type coercion (the bug that prompted these tests) ──────────────────

  it('handles string IDs from PostgreSQL (the bigint coercion bug)', async () => {
    // PostgreSQL returns bigint IDs as strings
    mockGetTracksWithEmbeddings.mockResolvedValue([
      { id: '5', threshold: 0.75, query_embedding: null },
    ]);
    // OpenSearch percolate returns parsed integers
    mockPercolatePost.mockResolvedValue([5]);

    const matches = await matchPost('PHP is great', 'did:test', 'at://test/post/1', fakeEmbedding);
    expect(matches).toContain(5);
  });

  it('handles numeric IDs consistently', async () => {
    mockGetTracksWithEmbeddings.mockResolvedValue([
      { id: 7, threshold: 0.75, query_embedding: null },
    ]);
    mockPercolatePost.mockResolvedValue([7]);

    const matches = await matchPost('test post', 'did:test', 'at://test/post/1', fakeEmbedding);
    expect(matches).toContain(7);
  });

  // ─── Keyword-only tracks ────────────────────────────────────────────────

  it('keyword-only track: matches when percolate matches (bypasses squelch)', async () => {
    mockGetTracksWithEmbeddings.mockResolvedValue([
      { id: '1', threshold: 0.99, query_embedding: null }, // high threshold irrelevant
    ]);
    mockPercolatePost.mockResolvedValue([1]);

    const matches = await matchPost('PHP rocks', 'did:test', 'at://test/post/1', fakeEmbedding);
    expect(matches).toContain(1);
  });

  it('keyword-only track: no match when percolate does not match', async () => {
    mockGetTracksWithEmbeddings.mockResolvedValue([
      { id: '1', threshold: 0.5, query_embedding: null },
    ]);
    mockPercolatePost.mockResolvedValue([]); // no keyword match

    const matches = await matchPost('no keywords here', 'did:test', 'at://test/post/1', fakeEmbedding);
    expect(matches).toHaveLength(0);
  });

  // ─── Semantic-only tracks ───────────────────────────────────────────────

  it('semantic-only track: matches when similarity exceeds threshold', async () => {
    mockGetTracksWithEmbeddings.mockResolvedValue([
      { id: '2', threshold: 0.5, query_embedding: similarEmbedding },
    ]);
    mockPercolatePost.mockResolvedValue([]);

    const matches = await matchPost('AI news', 'did:test', 'at://test/post/1', fakeEmbedding);
    expect(matches).toContain(2);
  });

  it('semantic-only track: does not match when similarity below threshold', async () => {
    mockGetTracksWithEmbeddings.mockResolvedValue([
      { id: '2', threshold: 0.95, query_embedding: dissimilarEmbedding },
    ]);
    mockPercolatePost.mockResolvedValue([]);

    const matches = await matchPost('unrelated post', 'did:test', 'at://test/post/1', fakeEmbedding);
    expect(matches).toHaveLength(0);
  });

  it('semantic-only track: threshold of 1.0 requires exact match', async () => {
    mockGetTracksWithEmbeddings.mockResolvedValue([
      { id: '2', threshold: 1.0, query_embedding: similarEmbedding },
    ]);
    mockPercolatePost.mockResolvedValue([]);

    // Identical embeddings → cos sim = 1.0, should pass threshold of 1.0
    const matches = await matchPost('exact match', 'did:test', 'at://test/post/1', similarEmbedding);
    expect(matches).toContain(2);
  });

  // ─── Hybrid tracks (keyword + semantic) ─────────────────────────────────

  it('hybrid track: keyword match passes when similarity exceeds squelch', async () => {
    mockGetTracksWithEmbeddings.mockResolvedValue([
      { id: '3', threshold: 0.5, query_embedding: similarEmbedding },
    ]);
    mockPercolatePost.mockResolvedValue([3]);

    const matches = await matchPost('PHP and AI', 'did:test', 'at://test/post/1', fakeEmbedding);
    expect(matches).toContain(3);
  });

  it('hybrid track: keyword match rejected when similarity below squelch', async () => {
    mockGetTracksWithEmbeddings.mockResolvedValue([
      { id: '3', threshold: 0.9, query_embedding: dissimilarEmbedding },
    ]);
    mockPercolatePost.mockResolvedValue([3]); // keyword matches...

    const matches = await matchPost('PHP mentioned in unrelated context', 'did:test', 'at://test/post/1', fakeEmbedding);
    // cos sim ≈ 0, threshold 0.9 → rejected
    expect(matches).not.toContain(3);
  });

  // ─── Inactive/paused tracks ─────────────────────────────────────────────

  it('paused tracks are excluded (not in active set)', async () => {
    // getTracksWithEmbeddings only returns active tracks, so a paused track
    // won't be in the result — percolate might still match it but it gets filtered
    mockGetTracksWithEmbeddings.mockResolvedValue([]); // no active tracks
    mockPercolatePost.mockResolvedValue([99]); // percolate matches stale query

    const matches = await matchPost('PHP post', 'did:test', 'at://test/post/1', fakeEmbedding);
    expect(matches).toHaveLength(0);
  });

  // ─── Deduplication ──────────────────────────────────────────────────────

  it('deduplicates when both keyword and semantic match the same track', async () => {
    mockGetTracksWithEmbeddings.mockResolvedValue([
      { id: '4', threshold: 0.5, query_embedding: similarEmbedding },
    ]);
    mockPercolatePost.mockResolvedValue([4]); // keyword match
    // semantic also matches (similarity ≈ 1.0 > 0.5)

    const matches = await matchPost('PHP AI news', 'did:test', 'at://test/post/1', fakeEmbedding);
    expect(matches).toEqual([4]); // only once
  });

  // ─── Multiple tracks ───────────────────────────────────────────────────

  it('matches multiple tracks independently', async () => {
    mockGetTracksWithEmbeddings.mockResolvedValue([
      { id: '1', threshold: 0.75, query_embedding: null },     // keyword-only
      { id: '2', threshold: 0.5, query_embedding: similarEmbedding }, // semantic
      { id: '3', threshold: 0.99, query_embedding: dissimilarEmbedding }, // won't match
    ]);
    mockPercolatePost.mockResolvedValue([1]); // only track 1 has keyword match

    const matches = await matchPost('PHP stuff', 'did:test', 'at://test/post/1', fakeEmbedding);
    expect(matches).toContain(1); // keyword boolean
    expect(matches).toContain(2); // semantic above 0.5
    expect(matches).not.toContain(3); // semantic below 0.99
  });

  // ─── Error handling ─────────────────────────────────────────────────────

  it('continues with semantic matching when percolate fails', async () => {
    mockGetTracksWithEmbeddings.mockResolvedValue([
      { id: '2', threshold: 0.5, query_embedding: similarEmbedding },
    ]);
    mockPercolatePost.mockRejectedValue(new Error('OpenSearch down'));

    const matches = await matchPost('test', 'did:test', 'at://test/post/1', fakeEmbedding);
    expect(matches).toContain(2); // semantic still works
  });
});

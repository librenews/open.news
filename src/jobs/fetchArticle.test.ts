import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock all external dependencies ──────────────────────────────────────────
vi.mock('../db/queries/articles.js', () => ({
  findArticleByUrl: vi.fn(),
  insertArticle: vi.fn(),
  updateArticleMeta: vi.fn(),
  setArticleUrl: vi.fn(),
  upsertArticleSource: vi.fn(),
  fanOutArticleToUsers: vi.fn(),
}));
vi.mock('../db/queries/sources.js', () => ({
  getSourceByDid: vi.fn(),
  touchSourceLastSeen: vi.fn(),
}));
vi.mock('../web/jobEnqueue.js', () => ({
  enqueueJob: vi.fn(),
}));
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
  findArticleByUrl, insertArticle, updateArticleMeta,
  setArticleUrl, upsertArticleSource, fanOutArticleToUsers,
} from '../db/queries/articles.js';
import { getSourceByDid } from '../db/queries/sources.js';
import { fetchArticleJob } from './fetchArticle.js';

const mockArticle = { id: BigInt(1), url: 'https://example.com/article', fetch_status: 'pending', is_news: false };
const mockSource = { id: BigInt(10) };

function makeResponse(url: string, body: string): Response {
  const enc = new TextEncoder();
  const bytes = enc.encode(body);
  const stream = new ReadableStream({
    start(c) { c.enqueue(bytes); c.close(); },
  });
  const res = new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findArticleByUrl).mockResolvedValue(null);
  vi.mocked(insertArticle).mockResolvedValue(mockArticle as never);
  vi.mocked(updateArticleMeta).mockResolvedValue(undefined);
  vi.mocked(setArticleUrl).mockResolvedValue(undefined);
  vi.mocked(upsertArticleSource).mockResolvedValue(undefined);
  vi.mocked(fanOutArticleToUsers).mockResolvedValue(undefined);
  vi.mocked(getSourceByDid).mockResolvedValue(mockSource as never);
  vi.stubGlobal('fetch', vi.fn());
});

const baseJob = {
  url: 'https://example.com/article',
  sourceDid: 'did:plc:abc',
  postUri: 'at://did:plc:abc/app.bsky.feed.post/xyz',
  postCid: 'bafyabc',
};

describe('fetchArticleJob', () => {
  describe('deduplication', () => {
    it('fan-outs without re-fetching when article is already fetched', async () => {
      const fetchedArticle = { ...mockArticle, fetch_status: 'fetched', is_news: true };
      vi.mocked(findArticleByUrl).mockResolvedValueOnce(fetchedArticle as never);
      vi.mocked(getSourceByDid).mockResolvedValueOnce(mockSource as never);

      await fetchArticleJob(baseJob);

      expect(fetch).not.toHaveBeenCalled();
      expect(upsertArticleSource).toHaveBeenCalledWith(fetchedArticle.id, mockSource.id, baseJob.postUri, baseJob.postCid);
      expect(fanOutArticleToUsers).toHaveBeenCalledWith(fetchedArticle.id, baseJob.sourceDid);
    });

    it('does not fan-out if already-fetched article is not news', async () => {
      const nonNewsArticle = { ...mockArticle, fetch_status: 'fetched', is_news: false };
      vi.mocked(findArticleByUrl).mockResolvedValueOnce(nonNewsArticle as never);

      await fetchArticleJob(baseJob);

      expect(fetch).not.toHaveBeenCalled();
      expect(fanOutArticleToUsers).not.toHaveBeenCalled();
    });
  });

  describe('short URL resolution', () => {
    it('regression: updates article URL when redirect is followed', async () => {
      const shortUrl = 'https://bit.ly/abc';
      const finalUrl = 'https://techcrunch.com/2024/01/story';
      const ogHtml = `<html><head>
        <meta property="og:type" content="article" />
        <meta property="og:title" content="TC Story" />
        <meta property="article:published_time" content="2024-01-01T00:00:00Z" />
      </head><body>${'word '.repeat(400)}</body></html>`;

      vi.mocked(findArticleByUrl).mockResolvedValue(null); // neither URL exists
      vi.mocked(insertArticle).mockResolvedValue({ ...mockArticle, url: shortUrl } as never);

      const res = makeResponse(finalUrl, ogHtml);
      vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(res);

      await fetchArticleJob({ ...baseJob, url: shortUrl });

      expect(setArticleUrl).toHaveBeenCalledWith(mockArticle.id, finalUrl);
    });

    it('merges with existing article when short URL resolves to known destination', async () => {
      const shortUrl = 'https://bit.ly/abc';
      const finalUrl = 'https://techcrunch.com/2024/01/story';
      const existingArticle = { ...mockArticle, url: finalUrl, fetch_status: 'fetched', is_news: true, id: BigInt(99) };

      // First call (short URL) → not found; second call (final URL) → found
      vi.mocked(findArticleByUrl)
        .mockResolvedValueOnce(null)             // stub insert
        .mockResolvedValueOnce(existingArticle as never); // final URL already in DB

      vi.mocked(insertArticle).mockResolvedValue({ ...mockArticle, url: shortUrl } as never);

      const res = makeResponse(finalUrl, '<html><head></head></html>');
      vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(res);

      await fetchArticleJob({ ...baseJob, url: shortUrl });

      // Should NOT set new URL — should mark stub as redirect and fan-out existing
      expect(setArticleUrl).not.toHaveBeenCalled();
      expect(updateArticleMeta).toHaveBeenCalledWith(
        mockArticle.id,
        expect.objectContaining({ fetch_status: 'redirect' })
      );
      expect(upsertArticleSource).toHaveBeenCalledWith(existingArticle.id, mockSource.id, baseJob.postUri, baseJob.postCid);
    });
  });

  describe('paywalled domains', () => {
    it('uses crawler mode for denylisted domains', async () => {
      const url = 'https://washingtonpost.com/weather/2024/story';
      vi.mocked(findArticleByUrl).mockResolvedValue(null);
      vi.mocked(insertArticle).mockResolvedValue({ ...mockArticle, url } as never);

      const html = `<html><head>
        <meta property="og:type" content="article" />
        <meta property="og:title" content="WashPost Story" />
        <meta property="article:published_time" content="2024-01-15T00:00:00Z" />
      </head></html>`;
      const res = makeResponse(url, html);
      vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(res);

      await fetchArticleJob({ ...baseJob, url });

      // Should call fetch with facebookexternalhit UA
      const [, opts] = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect((opts.headers as Record<string, string>)['User-Agent']).toContain('facebookexternalhit');

      // Should mark as paywalled
      expect(updateArticleMeta).toHaveBeenCalledWith(
        mockArticle.id,
        expect.objectContaining({ fetch_status: 'paywalled' })
      );
    });

    it('marks as skipped if crawler fetch also fails', async () => {
      const url = 'https://nytimes.com/2024/story';
      vi.mocked(findArticleByUrl).mockResolvedValue(null);
      vi.mocked(insertArticle).mockResolvedValue({ ...mockArticle, url } as never);
      vi.mocked(fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('connection refused'));

      await fetchArticleJob({ ...baseJob, url });

      expect(updateArticleMeta).toHaveBeenCalledWith(
        mockArticle.id,
        expect.objectContaining({ fetch_status: 'skipped' })
      );
    });
  });

  describe('error handling', () => {
    it('marks article as failed when fetch throws', async () => {
      vi.mocked(insertArticle).mockResolvedValue(mockArticle as never);
      vi.mocked(fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('timeout'));

      await fetchArticleJob(baseJob);

      expect(updateArticleMeta).toHaveBeenCalledWith(
        mockArticle.id,
        expect.objectContaining({ fetch_status: 'failed', is_news: false })
      );
    });
  });
});

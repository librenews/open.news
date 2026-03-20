import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger before importing articleFetcher — logger imports config which calls
// process.exit(1) when env vars are missing (no .env in test environment).
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { fetchUrlMeta } from './articleFetcher.js';

// Helper to create a mock Response
function mockResponse(opts: {
  url?: string;
  body?: string;
  headers?: Record<string, string>;
  throwOnRead?: boolean;
}): Response {
  const body = opts.body ?? '<html><head><title>Test</title></head><body>Content</body></html>';
  const encoder = new TextEncoder();
  const bytes = encoder.encode(body);
  let offset = 0;

  const stream = new ReadableStream({
    pull(controller) {
      if (opts.throwOnRead) {
        controller.error(new DOMException('The operation was aborted', 'AbortError'));
        return;
      }
      if (offset < bytes.length) {
        controller.enqueue(bytes.slice(offset, offset + 512));
        offset += 512;
      } else {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/html',
      ...opts.headers,
    },
  }) as Response & { url: string };
}

describe('fetchUrlMeta', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns metadata from a normal page', async () => {
    const html = `<html><head>
      <title>Test Article</title>
      <meta property="og:type" content="article" />
      <meta property="og:title" content="OG Title" />
      <meta property="og:description" content="A description" />
    </head><body></body></html>`;

    const res = mockResponse({ url: 'https://example.com/article', body: html });
    Object.defineProperty(res, 'url', { value: 'https://example.com/article' });
    vi.mocked(fetch).mockResolvedValueOnce(res);

    const meta = await fetchUrlMeta('https://example.com/article');
    expect(meta.title).toBe('OG Title');
    expect(meta.ogType).toBe('article');
    expect(meta.description).toBe('A description');
    expect(meta.finalUrl).toBe('https://example.com/article');
  });

  it('regression: returns finalUrl even when body read throws (timeout/bot-block)', async () => {
    // This is the core regression: bit.ly → washingtonpost.com where WashPost
    // blocks the body stream. We must still get finalUrl = washingtonpost.com.
    const res = mockResponse({ url: 'https://washingtonpost.com/article', throwOnRead: true });
    Object.defineProperty(res, 'url', { value: 'https://washingtonpost.com/article' });
    vi.mocked(fetch).mockResolvedValueOnce(res);

    // Should NOT throw, should return with correct finalUrl
    const meta = await fetchUrlMeta('https://bit.ly/abc');
    expect(meta.finalUrl).toBe('https://washingtonpost.com/article');
    expect(meta.html).toBe(''); // no body was read
  });

  it('uses opennews-bot UA by default', async () => {
    const res = mockResponse({});
    Object.defineProperty(res, 'url', { value: 'https://example.com' });
    vi.mocked(fetch).mockResolvedValueOnce(res);

    await fetchUrlMeta('https://example.com');

    const [, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['User-Agent']).toContain('opennews-bot');
  });

  it('uses facebookexternalhit UA in crawlerMode', async () => {
    const res = mockResponse({});
    Object.defineProperty(res, 'url', { value: 'https://example.com' });
    vi.mocked(fetch).mockResolvedValueOnce(res);

    await fetchUrlMeta('https://example.com', { crawlerMode: true });

    const [, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['User-Agent']).toContain('facebookexternalhit');
  });

  it('captures redirected finalUrl', async () => {
    const res = mockResponse({ body: '<html><head><title>T</title></head></html>' });
    Object.defineProperty(res, 'url', { value: 'https://real-site.com/article' });
    vi.mocked(fetch).mockResolvedValueOnce(res);

    const meta = await fetchUrlMeta('https://bit.ly/xyz');
    expect(meta.finalUrl).toBe('https://real-site.com/article');
  });

  it('parses JSON-LD type', async () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"NewsArticle","headline":"Test"}</script>
    </head></html>`;
    const res = mockResponse({ body: html });
    Object.defineProperty(res, 'url', { value: 'https://example.com' });
    vi.mocked(fetch).mockResolvedValueOnce(res);

    const meta = await fetchUrlMeta('https://example.com');
    expect(meta.jsonldType).toBe('NewsArticle');
  });

  it('parses article:published_time', async () => {
    const html = `<html><head>
      <meta property="article:published_time" content="2024-01-15T10:00:00Z" />
    </head></html>`;
    const res = mockResponse({ body: html });
    Object.defineProperty(res, 'url', { value: 'https://example.com' });
    vi.mocked(fetch).mockResolvedValueOnce(res);

    const meta = await fetchUrlMeta('https://example.com');
    expect(meta.publishedAt).toBeInstanceOf(Date);
    expect(meta.publishedAt?.getFullYear()).toBe(2024);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/config.js', () => ({
  config: { BRAVE_API_KEY: 'test-brave-key' },
}));

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { braveSearch } from './braveSearch.js';

describe('braveSearch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns search results from Brave API', async () => {
    const mockResponse = {
      web: {
        results: [
          {
            title: 'ATmosphere Conference 2026',
            url: 'https://atmosphere.conf/2026',
            description: 'Register for ATmosphere 2026',
            age: '2 hours ago',
            meta_url: { hostname: 'atmosphere.conf' },
          },
          {
            title: 'AT Protocol Developer Hub',
            url: 'https://atproto.com/dev',
            description: 'Developer resources for AT Protocol',
            meta_url: { hostname: 'atproto.com' },
          },
        ],
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const results = await braveSearch('ATmosphere Conference 2026 registration');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'ATmosphere Conference 2026',
      url: 'https://atmosphere.conf/2026',
      description: 'Register for ATmosphere 2026',
      age: '2 hours ago',
      site_name: 'atmosphere.conf',
    });

    // Verify API called correctly
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    expect(fetchCall[0]).toContain('api.search.brave.com');
    expect(fetchCall[1]?.headers).toHaveProperty('X-Subscription-Token', 'test-brave-key');
  });

  it('returns empty array on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
    } as Response);

    const results = await braveSearch('test query');
    expect(results).toEqual([]);
  });

  it('returns empty array when no web results', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    } as Response);

    const results = await braveSearch('obscure query');
    expect(results).toEqual([]);
  });

  it('passes count and freshness options', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    } as Response);

    await braveSearch('test', { count: 3, freshness: 'pd' });

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain('count=3');
    expect(url).toContain('freshness=pd');
  });
});

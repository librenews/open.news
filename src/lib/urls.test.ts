import { describe, it, expect } from 'vitest';
import { normalizeArticleUrl, extractDomain, extractUrlsFromPost } from './urls.js';

describe('normalizeArticleUrl', () => {
  it('strips utm_source param', () => {
    const result = normalizeArticleUrl('https://example.com/article?utm_source=twitter');
    expect(result).toBe('https://example.com/article');
  });

  it('strips multiple tracking params', () => {
    const result = normalizeArticleUrl('https://example.com/article?utm_source=fb&utm_medium=social&gclid=abc');
    expect(result).toBe('https://example.com/article');
  });

  it('preserves non-tracking params', () => {
    const result = normalizeArticleUrl('https://example.com/article?page=2&lang=en');
    expect(result).not.toBeNull();
    expect(result).toContain('page=2');
    expect(result).toContain('lang=en');
  });

  it('strips hash fragments', () => {
    const result = normalizeArticleUrl('https://example.com/article#section-2');
    expect(result).toBe('https://example.com/article');
  });

  it('removes trailing slash', () => {
    const result = normalizeArticleUrl('https://example.com/article/');
    expect(result).toBe('https://example.com/article');
  });

  it('returns null for invalid URLs', () => {
    expect(normalizeArticleUrl('not-a-url')).toBeNull();
    expect(normalizeArticleUrl('')).toBeNull();
  });

  it('sorts query parameters for consistent dedup', () => {
    const a = normalizeArticleUrl('https://example.com/article?z=1&a=2');
    const b = normalizeArticleUrl('https://example.com/article?a=2&z=1');
    expect(a).toBe(b);
  });

  it('strips utm_ prefixed params generically', () => {
    const result = normalizeArticleUrl('https://example.com/article?utm_anything=foo');
    expect(result).toBe('https://example.com/article');
  });
});

describe('extractDomain', () => {
  it('extracts hostname', () => {
    expect(extractDomain('https://www.example.com/article')).toBe('example.com');
  });

  it('strips www prefix', () => {
    expect(extractDomain('https://www.bbc.co.uk/news')).toBe('bbc.co.uk');
  });

  it('returns empty string for invalid URL', () => {
    expect(extractDomain('not-a-url')).toBe('');
  });
});

describe('extractUrlsFromPost', () => {
  it('extracts URLs from link facets', () => {
    const post = {
      facets: [
        {
          features: [
            { $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com/article' },
          ],
        },
      ],
    };
    expect(extractUrlsFromPost(post)).toEqual(['https://example.com/article']);
  });

  it('ignores non-link facet features', () => {
    const post = {
      facets: [
        {
          features: [
            { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:xxx' },
          ],
        },
      ],
    };
    expect(extractUrlsFromPost(post)).toEqual([]);
  });

  it('extracts URL from embed.external', () => {
    const post = {
      embed: {
        $type: 'app.bsky.embed.external',
        external: { uri: 'https://example.com/article' },
      },
    };
    expect(extractUrlsFromPost(post)).toEqual(['https://example.com/article']);
  });

  it('deduplicates URLs appearing in both facets and embed', () => {
    const url = 'https://example.com/article';
    const post = {
      facets: [{ features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }] }],
      embed: { $type: 'app.bsky.embed.external', external: { uri: url } },
    };
    expect(extractUrlsFromPost(post)).toEqual([url]);
  });

  it('returns empty array for post with no URLs', () => {
    expect(extractUrlsFromPost({ facets: [] })).toEqual([]);
    expect(extractUrlsFromPost({})).toEqual([]);
  });

  it('extracts multiple URLs from multiple facets', () => {
    const post = {
      facets: [
        { features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://a.com' }] },
        { features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://b.com' }] },
      ],
    };
    const result = extractUrlsFromPost(post);
    expect(result).toHaveLength(2);
    expect(result).toContain('https://a.com');
    expect(result).toContain('https://b.com');
  });
});

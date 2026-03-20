import { describe, it, expect } from 'vitest';
import { detectNews } from './articleDetector.js';
import type { FetchedMeta } from './articleFetcher.js';

const base: FetchedMeta = {
  canonicalUrl: null,
  title: null,
  description: null,
  imageUrl: null,
  author: null,
  publishedAt: null,
  siteName: null,
  ogType: null,
  jsonldType: null,
  html: '',
  finalUrl: 'https://example.com/article',
};

describe('detectNews', () => {
  describe('strong signals', () => {
    it('scores +4 for JSON-LD NewsArticle', () => {
      const { score, isNews } = detectNews({ ...base, jsonldType: 'NewsArticle' }, 'https://example.com/article', 0);
      expect(score).toBeGreaterThanOrEqual(4);
      expect(isNews).toBe(true);
    });

    it('scores +4 for JSON-LD Article', () => {
      const { isNews } = detectNews({ ...base, jsonldType: 'Article' }, 'https://example.com/article', 0);
      expect(isNews).toBe(true);
    });

    it('scores +3 for og:type=article', () => {
      const { score } = detectNews({ ...base, ogType: 'article' }, 'https://example.com/article', 0);
      expect(score).toBeGreaterThanOrEqual(3);
    });

    it('og:type=article alone is NOT enough (3 - 1 no-signal = 2, below 4)', () => {
      const { isNews } = detectNews({ ...base, ogType: 'article' }, 'https://example.com', 0);
      expect(isNews).toBe(false);
    });

    it('og:type=article + publishedAt hits threshold', () => {
      const { isNews } = detectNews(
        { ...base, ogType: 'article', publishedAt: new Date() },
        'https://example.com/article', 0
      );
      expect(isNews).toBe(true);
    });
  });

  describe('cumulative weak signals', () => {
    it('title + publishedAt + author + news URL pattern → is_news (no strong signal -1 penalty)', () => {
      const { score, isNews } = detectNews(
        { ...base, title: 'Some news', publishedAt: new Date(), author: 'Jane' },
        'https://example.com/news/story', 400
      );
      // +1 title +2 date +1 author +1 news-url +1 words -1 no-strong = 5
      expect(score).toBe(5);
      expect(isNews).toBe(true);
    });

    it('is below threshold without enough signals', () => {
      const { isNews } = detectNews(
        { ...base, title: 'Hello world' },
        'https://example.com', 50
      );
      expect(isNews).toBe(false);
    });
  });

  describe('URL penalties', () => {
    it('penalises /static/ paths (-3)', () => {
      const { score } = detectNews(
        { ...base, ogType: 'article', publishedAt: new Date() },
        'https://example.com/static/dynazoom.html', 0
      );
      // +3 og +2 date -3 static -1 no-signal... wait og IS a strong signal so no -1
      // +3 + 2 - 3 = 2
      expect(score).toBeLessThan(4);
    });

    it('penalises URLs with 4+ query params (-3)', () => {
      const url = 'https://bskycharts.edavis.dev/static/dynazoom.html?a=1&b=2&c=3&d=4&e=5&f=6';
      const { isNews } = detectNews(
        { ...base, title: 'Chart', publishedAt: new Date() },
        url, 400
      );
      expect(isNews).toBe(false);
    });

    it('penalises 2-3 query params (-1)', () => {
      const url = 'https://example.com/article?ref=twitter&section=politics';
      const { score } = detectNews(
        { ...base, jsonldType: 'NewsArticle' },
        url, 0
      );
      // +4 jsonld -1 params = 3? Actually 4 - 1 = 3 < 4... with no other signals
      // But +4 from jsonld means strong signal, no -1 penalty
      expect(score).toBe(3); // 4 - 1 (2 params penalty)
    });

    it('penalises non-article file extensions', () => {
      const { score } = detectNews(
        { ...base, title: 'Feed' },
        'https://example.com/feed.xml', 0
      );
      expect(score).toBeLessThan(0);
    });

    it('bonuses date-based paths', () => {
      const { score: withDate } = detectNews({ ...base }, 'https://example.com/2024/01/story', 0);
      const { score: without } = detectNews({ ...base }, 'https://example.com/story', 0);
      expect(withDate).toBeGreaterThan(without);
    });

    it('bonuses /news/ paths', () => {
      const { score: withNews } = detectNews({ ...base }, 'https://example.com/news/story', 0);
      const { score: without } = detectNews({ ...base }, 'https://example.com/story', 0);
      expect(withNews).toBeGreaterThan(without);
    });
  });

  describe('word count', () => {
    it('+1 bonus for word count >= 300', () => {
      const { score: low } = detectNews({ ...base }, 'https://example.com', 299);
      const { score: high } = detectNews({ ...base }, 'https://example.com', 300);
      expect(high).toBe(low + 1);
    });
  });

  describe('og:type=website penalty', () => {
    it('applies -2 when no strong signal and og:type=website', () => {
      const { score } = detectNews({ ...base, ogType: 'website' }, 'https://example.com', 0);
      expect(score).toBeLessThan(0);
    });
  });

  describe('regression: bskycharts false positive', () => {
    it('rejects dynazoom stats page', () => {
      const url = 'https://bskycharts.edavis.dev/static/dynazoom.html?cgiurl_graph=/munin-cgi/munin-cgi-graph&lower_limit=&plugin_name=foo&size_x=800&start_epoch=1701331200&start_iso8601=2024-00-00T00:00:00&stop_epoch=1780297200&stop_iso8601=2026-06-01T00:00:00&upper_limit=';
      const { isNews } = detectNews(
        { ...base, title: 'BSky Users Total', publishedAt: new Date() },
        url, 300
      );
      expect(isNews).toBe(false);
    });
  });
});

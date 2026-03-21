import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;        // e.g. "2 hours ago"
  site_name?: string;
}

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  meta_url?: { hostname?: string };
}

interface BraveSearchResponse {
  web?: { results: BraveWebResult[] };
  news?: { results: BraveWebResult[] };
  query?: { original: string };
}

function mapResults(results: BraveWebResult[]): SearchResult[] {
  return results.map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description,
    age: r.age,
    site_name: r.meta_url?.hostname,
  }));
}

async function braveSearchInternal(
  endpoint: 'web' | 'news',
  query: string,
  opts?: { count?: number; freshness?: string }
): Promise<SearchResult[]> {
  if (!config.BRAVE_API_KEY) {
    logger.debug('Brave Search skipped — no BRAVE_API_KEY configured');
    return [];
  }

  const count = opts?.count ?? 5;
  const params = new URLSearchParams({
    q: query,
    count: String(count),
    text_decorations: 'false',
    search_lang: 'en',
  });
  if (opts?.freshness) params.set('freshness', opts.freshness);

  const url = `https://api.search.brave.com/res/v1/${endpoint}/search?${params}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': config.BRAVE_API_KEY,
    },
  });

  if (!response.ok) {
    logger.error({ status: response.status, statusText: response.statusText, endpoint }, 'Brave Search API error');
    return [];
  }

  const data = (await response.json()) as BraveSearchResponse;
  const results = endpoint === 'news'
    ? data.news?.results ?? []
    : data.web?.results ?? [];

  return mapResults(results);
}

/**
 * Search the web using Brave Web Search API.
 * Returns empty array if BRAVE_API_KEY is not configured.
 */
export async function braveSearch(
  query: string,
  opts?: { count?: number; freshness?: string }
): Promise<SearchResult[]> {
  return braveSearchInternal('web', query, opts);
}

/**
 * Search news using Brave News Search API.
 * Prioritized for news_question intents as results are more relevant.
 * Returns empty array if BRAVE_API_KEY is not configured.
 */
export async function braveNewsSearch(
  query: string,
  opts?: { count?: number; freshness?: string }
): Promise<SearchResult[]> {
  return braveSearchInternal('news', query, opts);
}

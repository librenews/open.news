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
  query?: { original: string };
}

/**
 * Search the web using Brave Search API.
 * Returns empty array if BRAVE_API_KEY is not configured.
 */
export async function braveSearch(
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

  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': config.BRAVE_API_KEY,
    },
  });

  if (!response.ok) {
    logger.error({ status: response.status, statusText: response.statusText }, 'Brave Search API error');
    return [];
  }

  const data = (await response.json()) as BraveSearchResponse;
  const results = data.web?.results ?? [];

  return results.map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description,
    age: r.age,
    site_name: r.meta_url?.hostname,
  }));
}

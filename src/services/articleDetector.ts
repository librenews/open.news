import type { FetchedMeta } from './articleFetcher.js';

const NEWS_SCORE_THRESHOLD = 4;

const NEWS_URL_PATTERNS = [
  /\/article[s]?\//i,
  /\/news\//i,
  /\/stor(y|ies)\//i,
  /\/post\//i,
  /\/\d{4}\/\d{2}\//,  // date-based paths like /2024/01/
];

// Paths that strongly suggest non-article content
const NON_ARTICLE_PATH_PATTERNS = [
  /\/static\//i,
  /\/assets\//i,
  /\/img(ages)?\//i,
  /\/cdn\//i,
  /\/embed\//i,
  /\/widget\//i,
];

// File extensions that are never articles
const NON_ARTICLE_EXTENSIONS = /\.(xml|json|rss|atom|svg|png|jpg|jpeg|gif|webp|pdf|zip|gz)$/i;

export interface DetectionResult {
  score: number;
  isNews: boolean;
}

export function detectNews(
  meta: FetchedMeta,
  url: string,
  wordCount: number
): DetectionResult {
  let score = 0;
  let hasStrongSignal = false;

  // +4: JSON-LD type contains NewsArticle or Article
  if (meta.jsonldType && /NewsArticle|Article/i.test(meta.jsonldType)) {
    score += 4;
    hasStrongSignal = true;
  }

  // +3: og:type = article
  if (meta.ogType === 'article') {
    score += 3;
    hasStrongSignal = true;
  }

  // +2: has article:published_time
  if (meta.publishedAt) score += 2;

  // +1: has author
  if (meta.author) score += 1;

  // +1: has title
  if (meta.title) score += 1;

  // URL-based signals
  try {
    const parsed = new URL(url);
    const { pathname, search } = parsed;

    // +1: URL path matches known news patterns
    if (NEWS_URL_PATTERNS.some((p) => p.test(pathname))) score += 1;

    // -3: non-article path (static assets, embeds, etc.)
    if (NON_ARTICLE_PATH_PATTERNS.some((p) => p.test(pathname))) score -= 3;

    // -2: non-article file extension
    if (NON_ARTICLE_EXTENSIONS.test(pathname)) score -= 2;

    // -3: URL has many query params — typical of app/tool pages, not articles
    const paramCount = [...new URLSearchParams(search).keys()].length;
    if (paramCount >= 4) score -= 3;
    else if (paramCount >= 2) score -= 1;
  } catch {
    // ignore invalid URLs
  }

  // +1: word count >= 300
  if (wordCount >= 300) score += 1;

  // -1: no strong signal (no og:article, no JSON-LD) — soft nudge down for untagged pages
  if (!hasStrongSignal) score -= 1;

  // -2: og:type = website with no other signals
  if (meta.ogType === 'website' && score <= 0) score -= 2;

  return {
    score,
    isNews: score >= NEWS_SCORE_THRESHOLD,
  };
}

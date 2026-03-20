import * as cheerio from 'cheerio';
import { logger } from '../lib/logger.js';

const USER_AGENT = 'opennews-bot/1.0 (+https://open.news)';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB

export interface FetchedMeta {
  canonicalUrl: string | null;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  author: string | null;
  publishedAt: Date | null;
  siteName: string | null;
  ogType: string | null;
  jsonldType: string | null;
  html: string;
  finalUrl: string;
}

export async function fetchUrlMeta(url: string): Promise<FetchedMeta> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html = '';
  let finalUrl = url;

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });

    finalUrl = response.url || url;

    // Stream and cap at MAX_RESPONSE_BYTES
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    let bytesRead = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        bytesRead += value.length;
        chunks.push(value);
        if (bytesRead >= MAX_RESPONSE_BYTES) {
          await reader.cancel();
          break;
        }
      }
    }

    html = new TextDecoder().decode(
      chunks.reduce((acc, chunk) => {
        const merged = new Uint8Array(acc.length + chunk.length);
        merged.set(acc);
        merged.set(chunk, acc.length);
        return merged;
      }, new Uint8Array())
    );
  } finally {
    clearTimeout(timeout);
  }

  return { ...parseMeta(html, finalUrl), html, finalUrl };
}

function parseMeta(html: string, url: string): Omit<FetchedMeta, 'html' | 'finalUrl'> {
  const $ = cheerio.load(html);

  // JSON-LD
  let jsonldType: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (jsonldType) return;
    try {
      const data = JSON.parse($(el).html() ?? '{}');
      const type = Array.isArray(data) ? data[0]?.['@type'] : data['@type'];
      if (type) jsonldType = Array.isArray(type) ? type[0] : type;
    } catch {
      // ignore parse errors
    }
  });

  // Open Graph / meta tags
  const ogMeta: Record<string, string> = {};
  $('meta[property^="og:"], meta[name^="og:"]').each((_, el) => {
    const prop = ($(el).attr('property') || $(el).attr('name') || '').replace('og:', '');
    const content = $(el).attr('content');
    if (prop && content) ogMeta[prop] = content;
  });

  const articleMeta: Record<string, string> = {};
  $('meta[property^="article:"], meta[name^="article:"]').each((_, el) => {
    const prop = ($(el).attr('property') || $(el).attr('name') || '').replace('article:', '');
    const content = $(el).attr('content');
    if (prop && content) articleMeta[prop] = content;
  });

  const author =
    articleMeta['author'] ||
    ogMeta['author'] ||
    $('meta[name="author"]').attr('content') ||
    null;

  const rawPublished = articleMeta['published_time'] || ogMeta['article:published_time'];
  const publishedAt = rawPublished ? new Date(rawPublished) : null;

  const canonicalUrl =
    $('link[rel="canonical"]').attr('href') || null;

  return {
    canonicalUrl,
    title: ogMeta['title'] || $('title').first().text().trim() || null,
    description: ogMeta['description'] || $('meta[name="description"]').attr('content') || null,
    imageUrl: ogMeta['image'] || null,
    author,
    publishedAt: publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null,
    siteName: ogMeta['site_name'] || null,
    ogType: ogMeta['type'] || null,
    jsonldType,
  };
}

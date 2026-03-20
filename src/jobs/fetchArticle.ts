import { fetchUrlMeta } from '../services/articleFetcher.js';
import { detectNews } from '../services/articleDetector.js';
import { extractArticleText } from '../services/articleText.js';
import {
  findArticleByUrl,
  insertArticle,
  updateArticleMeta,
  setArticleUrl,
  upsertArticleSource,
  fanOutArticleToUsers,
} from '../db/queries/articles.js';
import { getSourceByDid } from '../db/queries/sources.js';
import { logger } from '../lib/logger.js';

export interface FetchArticleJobData {
  url: string;
  sourceDid: string;
  postUri: string;
  postCid: string;
}

// Domains known to block headless fetches (paywalls, bot-detection).
// Mark these failed immediately without burning retries.
const FETCH_DENYLIST = new Set([
  'washingtonpost.com', 'nytimes.com', 'wsj.com', 'ft.com',
  'bloomberg.com', 'economist.com', 'thetimes.co.uk', 'telegraph.co.uk',
  'wired.com', 'newyorker.com', 'theatlantic.com',
]);

// Known short-URL domains — resolve to final URL via HEAD before storing anything.
const SHORTENER_DOMAINS = new Set([
  'bit.ly', 'trib.al', 't.co', 'ow.ly', 'buff.ly', 'dlvr.it',
  'ift.tt', 'goo.gl', 'tiny.cc', 'tinyurl.com', 'rb.gy', 'is.gd',
  'shorturl.at', 'cutt.ly', 'link.medium.com',
]);

function isDenylisted(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return FETCH_DENYLIST.has(host);
  } catch { return false; }
}

export async function fetchArticleJob(data: FetchArticleJobData): Promise<void> {
  const { url, sourceDid, postUri, postCid } = data;
  logger.info({ url }, 'Fetching article');

  // Dedup check (may have been inserted by another concurrent job)
  const existing = await findArticleByUrl(url);
  const article = existing ?? (await insertArticle({ url }));

  // If already successfully fetched, just fan-out
  if (existing?.fetch_status === 'fetched') {
    if (existing.is_news) {
      const source = await getSourceByDid(sourceDid);
      if (source) {
        await upsertArticleSource(existing.id, source.id, postUri, postCid);
        await fanOutArticleToUsers(existing.id, sourceDid);
      }
    }
    return;
  }

  // Paywalled / bot-blocked domains: use crawler UA to get OG tags only (no full text)
  if (isDenylisted(url)) {
    try {
      const meta = await fetchUrlMeta(url, { crawlerMode: true });
      const { score, isNews } = detectNews(meta, url, 0); // wordCount=0, no full text
      await updateArticleMeta(article.id, {
        canonical_url: meta.canonicalUrl,
        title: meta.title,
        description: meta.description,
        image_url: meta.imageUrl,
        author: meta.author,
        published_at: meta.publishedAt,
        site_name: meta.siteName,
        og_type: meta.ogType,
        jsonld_type: meta.jsonldType,
        news_score: score,
        is_news: isNews,
        fetch_status: 'paywalled',
      });
      logger.info({ url, score, isNews }, 'Paywalled article: OG tags fetched via crawler UA');
      if (isNews) {
        const source = await getSourceByDid(sourceDid);
        if (source) {
          await upsertArticleSource(article.id, source.id, postUri, postCid);
          await fanOutArticleToUsers(article.id, sourceDid);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ url, err: message }, 'Paywalled article: crawler fetch also failed');
      await updateArticleMeta(article.id, { news_score: 0, is_news: false, fetch_status: 'skipped', fetch_error: 'domain denylisted' });
    }
    return;
  }

  try {
    const meta = await fetchUrlMeta(url);
    const finalUrl = meta.finalUrl ?? url;

    // ── Short-URL resolution ───────────────────────────────────────────────
    // If the fetch followed a redirect to a different URL, check whether
    // the destination already exists. If so, use it and discard the stub.
    let targetArticleId = article.id;
    if (finalUrl !== url) {
      const atFinal = await findArticleByUrl(finalUrl);
      if (atFinal) {
        // Destination already in DB — mark stub as redirect, fan-out via existing
        await updateArticleMeta(article.id, { news_score: 0, is_news: false, fetch_status: 'redirect', fetch_error: `-> ${finalUrl}` });
        if (atFinal.is_news) {
          const source = await getSourceByDid(sourceDid);
          if (source) {
            await upsertArticleSource(atFinal.id, source.id, postUri, postCid);
            await fanOutArticleToUsers(atFinal.id, sourceDid);
          }
        }
        logger.info({ url, finalUrl }, 'Short URL resolved to existing article');
        return;
      }
      // Destination is new — update stub URL so future dedup hits the real URL
      await setArticleUrl(article.id, finalUrl);
      logger.debug({ url, finalUrl }, 'Short URL resolved, updated article URL');
    }

    const { fullText, wordCount } = extractArticleText(meta.html, finalUrl);
    const { score, isNews } = detectNews(meta, finalUrl, wordCount);

    await updateArticleMeta(targetArticleId, {
      canonical_url: meta.canonicalUrl,
      title: meta.title,
      description: meta.description,
      image_url: meta.imageUrl,
      author: meta.author,
      published_at: meta.publishedAt,
      site_name: meta.siteName,
      og_type: meta.ogType,
      jsonld_type: meta.jsonldType,
      news_score: score,
      is_news: isNews,
      fetch_status: 'fetched',
      full_text: fullText,
      word_count: wordCount,
    });

    logger.info({ url, score, isNews, wordCount }, 'Article fetched and scored');

    if (isNews) {
      const source = await getSourceByDid(sourceDid);
      if (source) {
        await upsertArticleSource(article.id, source.id, postUri, postCid);
        await fanOutArticleToUsers(article.id, sourceDid);
      }
      // botPost job would be enqueued here in a real deployment
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ url, err: message }, 'Article fetch failed');
    await updateArticleMeta(article.id, {
      news_score: 0,
      is_news: false,
      fetch_status: 'failed',
      fetch_error: message,
    });
  }
}

import { db } from '../client.js';
import { getOsClient, SITE_STANDARD_INDEX, SITE_STANDARD_CHUNKS_INDEX } from '../../track/opensearch.js';
import { logger } from '../../lib/logger.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface VerifiedArticle {
  uri: string;
  author_did: string;
  author_handle: string | null;
  title: string | null;
  description: string | null;
  published_at: string | null;
  site: string | null;
  path: string | null;
  language: string | null;
  word_count: number;
  like_count: number;
  repost_count: number;
  share_count: number;
}

export interface RelatedArticle {
  uri: string;
  title: string | null;
  site: string | null;
  published_at: string | null;
  author_did: string | null;
  score: number;
}

export interface AuthorSummary {
  did: string;
  handle: string | null;
  article_count: number;
  total_likes: number;
  latest_published: string | null;
}

export interface TopicCluster {
  id: number;
  label: string;
  article_count: number;
  sample_uris: string[];
}

// ── Verified Article Feed ────────────────────────────────────────────────────

/**
 * Fetch verified site_standard articles, ranked by a blend of recency and
 * interaction signals.  Used for the public front page.
 */
export async function getVerifiedArticles(
  limit = 40,
  offset = 0,
  options: { language?: string; site?: string; authorDid?: string } = {},
): Promise<VerifiedArticle[]> {
  const params: unknown[] = [limit, offset];
  const filters: string[] = ['a.verified = true', 'a.suppressed IS NOT TRUE'];

  if (options.language) {
    params.push(options.language);
    filters.push(`a.language = $${params.length}`);
  }
  if (options.site) {
    params.push(options.site);
    filters.push(`a.site = $${params.length}`);
  }
  if (options.authorDid) {
    params.push(options.authorDid);
    filters.push(`a.author_did = $${params.length}`);
  }

  const { rows } = await db.query(
    `SELECT
       a.uri, a.author_did, a.author_handle, a.title, a.description,
       a.published_at, a.site, a.path, a.language, a.word_count,
       COALESCE(lk.cnt, 0)::int AS like_count,
       COALESCE(rp.cnt, 0)::int AS repost_count,
       COALESCE(sh.cnt, 0)::int AS share_count
     FROM site_standard_articles a
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS cnt FROM article_interactions
       WHERE article_uri = a.uri AND interaction_type = 'like'
     ) lk ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS cnt FROM article_interactions
       WHERE article_uri = a.uri AND interaction_type = 'repost'
     ) rp ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS cnt FROM article_interactions
       WHERE article_uri = a.uri AND interaction_type = 'share'
     ) sh ON true
     WHERE ${filters.join(' AND ')}
     ORDER BY
       /* Hotness: interactions weighted + time decay */
       (COALESCE(lk.cnt,0)*1.0 + COALESCE(rp.cnt,0)*2.0 + COALESCE(sh.cnt,0)*3.0 + 1)
         / POWER(GREATEST(EXTRACT(EPOCH FROM (NOW() - COALESCE(a.published_at, a.created_at))) / 3600, 0) + 2, 1.3)
       DESC,
       a.published_at DESC NULLS LAST
     LIMIT $1 OFFSET $2`,
    params,
  );

  return rows.map((r: any) => ({
    uri: r.uri,
    author_did: r.author_did,
    author_handle: r.author_handle,
    title: r.title,
    description: r.description,
    published_at: r.published_at?.toISOString?.() ?? r.published_at ?? null,
    site: r.site,
    path: r.path,
    language: r.language,
    word_count: Number(r.word_count ?? 0),
    like_count: Number(r.like_count),
    repost_count: Number(r.repost_count),
    share_count: Number(r.share_count),
  }));
}

/**
 * Get the latest verified articles, pure reverse-chronological.
 */
export async function getLatestVerifiedArticles(
  limit = 40,
  offset = 0,
): Promise<VerifiedArticle[]> {
  const { rows } = await db.query(
    `SELECT
       a.uri, a.author_did, a.author_handle, a.title, a.description,
       a.published_at, a.site, a.path, a.language, a.word_count,
       COALESCE(lk.cnt, 0)::int AS like_count,
       COALESCE(rp.cnt, 0)::int AS repost_count,
       COALESCE(sh.cnt, 0)::int AS share_count
     FROM site_standard_articles a
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS cnt FROM article_interactions
       WHERE article_uri = a.uri AND interaction_type = 'like'
     ) lk ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS cnt FROM article_interactions
       WHERE article_uri = a.uri AND interaction_type = 'repost'
     ) rp ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS cnt FROM article_interactions
       WHERE article_uri = a.uri AND interaction_type = 'share'
     ) sh ON true
     WHERE a.verified = true AND a.suppressed IS NOT TRUE
     ORDER BY a.published_at DESC NULLS LAST
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  return rows.map((r: any) => ({
    uri: r.uri,
    author_did: r.author_did,
    author_handle: r.author_handle,
    title: r.title,
    description: r.description,
    published_at: r.published_at?.toISOString?.() ?? r.published_at ?? null,
    site: r.site,
    path: r.path,
    language: r.language,
    word_count: Number(r.word_count ?? 0),
    like_count: Number(r.like_count),
    repost_count: Number(r.repost_count),
    share_count: Number(r.share_count),
  }));
}

// ── Related Articles (OpenSearch MLT) ────────────────────────────────────────

/**
 * Find articles related to a given one via OpenSearch More-Like-This.
 */
export async function getRelatedArticles(
  articleUri: string,
  limit = 5,
): Promise<RelatedArticle[]> {
  try {
    const os = getOsClient();
    const res = await os.search({
      index: SITE_STANDARD_INDEX,
      body: {
        size: limit,
        query: {
          bool: {
            must: {
              more_like_this: {
                fields: ['title^3', 'title.*^2', 'text_content', 'text_content.*'],
                like: [{ _index: SITE_STANDARD_INDEX, _id: articleUri }],
                min_term_freq: 1,
                max_query_terms: 25,
                min_word_length: 3,
              },
            },
            filter: { term: { verified: true } },
          },
        },
        _source: ['title', 'site', 'published_at', 'did', 'uri'],
      },
    });
    return (res.body.hits?.hits || []).map((h: any) => ({
      uri: h._source.uri ?? h._id,
      title: h._source.title,
      site: h._source.site,
      published_at: h._source.published_at,
      author_did: h._source.did,
      score: h._score ?? 0,
    }));
  } catch (err) {
    logger.warn({ err, articleUri }, 'getRelatedArticles failed');
    return [];
  }
}

// ── Closest Authors ──────────────────────────────────────────────────────────

/**
 * Find authors whose content is most similar to a given article by using
 * knn search on chunk embeddings and aggregating by author DID.
 */
export async function getClosestAuthors(
  articleUri: string,
  limit = 5,
): Promise<string[]> {
  try {
    const os = getOsClient();

    // 1. Get the first chunk embedding for this article
    const docRes = await os.search({
      index: SITE_STANDARD_CHUNKS_INDEX,
      body: {
        size: 1,
        query: { term: { uri: articleUri } },
        _source: ['embedding'],
      },
    });
    const vector = docRes.body.hits?.hits?.[0]?._source?.embedding;
    if (!vector || !Array.isArray(vector)) return [];

    // 2. knn to find similar chunks, aggregate by did
    const knnRes = await os.search({
      index: SITE_STANDARD_CHUNKS_INDEX,
      body: {
        size: limit * 5,
        query: {
          knn: {
            embedding: { vector, k: limit * 5 },
          },
        },
        _source: ['did'],
      },
    });

    // Extract unique DIDs (excluding the article's own author)
    const { rows: [ownRow] } = await db.query(
      'SELECT author_did FROM site_standard_articles WHERE uri = $1',
      [articleUri],
    );
    const ownDid = ownRow?.author_did;
    const seen = new Set<string>();
    const result: string[] = [];
    for (const hit of knnRes.body.hits?.hits || []) {
      const did = hit._source?.did;
      if (did && did !== ownDid && !seen.has(did)) {
        seen.add(did);
        result.push(did);
        if (result.length >= limit) break;
      }
    }
    return result;
  } catch (err) {
    logger.warn({ err, articleUri }, 'getClosestAuthors failed');
    return [];
  }
}

// ── Influenced-By / Built-Upon ───────────────────────────────────────────────

/**
 * Articles that likely influenced this one — similar content published *before*.
 */
export async function getInfluencedBy(
  articleUri: string,
  limit = 5,
): Promise<RelatedArticle[]> {
  try {
    // Get article's published date
    const { rows: [meta] } = await db.query(
      'SELECT published_at FROM site_standard_articles WHERE uri = $1',
      [articleUri],
    );
    if (!meta?.published_at) return [];

    const os = getOsClient();
    const res = await os.search({
      index: SITE_STANDARD_INDEX,
      body: {
        size: limit,
        query: {
          bool: {
            must: {
              more_like_this: {
                fields: ['title^3', 'text_content'],
                like: [{ _index: SITE_STANDARD_INDEX, _id: articleUri }],
                min_term_freq: 1,
                max_query_terms: 20,
              },
            },
            filter: [
              { term: { verified: true } },
              { range: { published_at: { lt: meta.published_at.toISOString() } } },
            ],
          },
        },
        _source: ['title', 'site', 'published_at', 'did', 'uri'],
      },
    });

    return (res.body.hits?.hits || []).map((h: any) => ({
      uri: h._source.uri ?? h._id,
      title: h._source.title,
      site: h._source.site,
      published_at: h._source.published_at,
      author_did: h._source.did,
      score: h._score ?? 0,
    }));
  } catch (err) {
    logger.warn({ err, articleUri }, 'getInfluencedBy failed');
    return [];
  }
}

/**
 * Articles that built upon this one — similar content published *after*.
 */
export async function getBuiltUpon(
  articleUri: string,
  limit = 5,
): Promise<RelatedArticle[]> {
  try {
    const { rows: [meta] } = await db.query(
      'SELECT published_at FROM site_standard_articles WHERE uri = $1',
      [articleUri],
    );
    if (!meta?.published_at) return [];

    const os = getOsClient();
    const res = await os.search({
      index: SITE_STANDARD_INDEX,
      body: {
        size: limit,
        query: {
          bool: {
            must: {
              more_like_this: {
                fields: ['title^3', 'text_content'],
                like: [{ _index: SITE_STANDARD_INDEX, _id: articleUri }],
                min_term_freq: 1,
                max_query_terms: 20,
              },
            },
            filter: [
              { term: { verified: true } },
              { range: { published_at: { gt: meta.published_at.toISOString() } } },
            ],
          },
        },
        _source: ['title', 'site', 'published_at', 'did', 'uri'],
      },
    });

    return (res.body.hits?.hits || []).map((h: any) => ({
      uri: h._source.uri ?? h._id,
      title: h._source.title,
      site: h._source.site,
      published_at: h._source.published_at,
      author_did: h._source.did,
      score: h._score ?? 0,
    }));
  } catch (err) {
    logger.warn({ err, articleUri }, 'getBuiltUpon failed');
    return [];
  }
}

// ── Emerging Discussions ─────────────────────────────────────────────────────

/**
 * Recent social interactions (likes/reposts/shares) on an article.
 */
export async function getEmergingDiscussions(
  articleUri: string,
  windowHours = 48,
  limit = 10,
): Promise<{ actor_did: string; interaction_type: string; created_at: string }[]> {
  const { rows } = await db.query(
    `SELECT actor_did, interaction_type, created_at
     FROM article_interactions
     WHERE article_uri = $1
       AND created_at >= NOW() - INTERVAL '1 hour' * $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [articleUri, windowHours, limit],
  );
  return rows.map((r: any) => ({
    actor_did: r.actor_did,
    interaction_type: r.interaction_type,
    created_at: r.created_at?.toISOString?.() ?? r.created_at,
  }));
}

// ── Author Profile ───────────────────────────────────────────────────────────

export interface AuthorProfile {
  did: string;
  handle: string | null;
  article_count: number;
  total_likes: number;
  total_reposts: number;
  total_shares: number;
  first_published: string | null;
  latest_published: string | null;
  top_sites: string[];
}

export async function getAuthorProfile(did: string): Promise<AuthorProfile | null> {
  const { rows } = await db.query(
    `SELECT
       a.author_did AS did,
       MAX(a.author_handle) AS handle,
       COUNT(*)::int AS article_count,
       COALESCE(SUM(lk.cnt), 0)::int AS total_likes,
       COALESCE(SUM(rp.cnt), 0)::int AS total_reposts,
       COALESCE(SUM(sh.cnt), 0)::int AS total_shares,
       MIN(a.published_at) AS first_published,
       MAX(a.published_at) AS latest_published
     FROM site_standard_articles a
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS cnt FROM article_interactions
       WHERE article_uri = a.uri AND interaction_type = 'like'
     ) lk ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS cnt FROM article_interactions
       WHERE article_uri = a.uri AND interaction_type = 'repost'
     ) rp ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS cnt FROM article_interactions
       WHERE article_uri = a.uri AND interaction_type = 'share'
     ) sh ON true
     WHERE a.author_did = $1 AND a.verified = true
     GROUP BY a.author_did`,
    [did],
  );
  if (rows.length === 0) return null;

  const r = rows[0];

  // Top sites
  const { rows: siteRows } = await db.query(
    `SELECT site, COUNT(*)::int AS cnt
     FROM site_standard_articles
     WHERE author_did = $1 AND verified = true AND site IS NOT NULL
     GROUP BY site ORDER BY cnt DESC LIMIT 5`,
    [did],
  );

  return {
    did: r.did,
    handle: r.handle,
    article_count: Number(r.article_count),
    total_likes: Number(r.total_likes),
    total_reposts: Number(r.total_reposts),
    total_shares: Number(r.total_shares),
    first_published: r.first_published?.toISOString?.() ?? null,
    latest_published: r.latest_published?.toISOString?.() ?? null,
    top_sites: siteRows.map((s: any) => s.site),
  };
}

/**
 * Fetch verified articles by a specific author.
 */
export async function getAuthorArticles(
  did: string,
  limit = 30,
  offset = 0,
): Promise<VerifiedArticle[]> {
  return getVerifiedArticles(limit, offset, { authorDid: did });
}

// ── Front Page Stats ─────────────────────────────────────────────────────────

export async function getFrontPageStats(): Promise<{
  totalArticles: number;
  totalAuthors: number;
  totalSites: number;
  articlesToday: number;
}> {
  const { rows } = await db.query(`
    SELECT
      (SELECT COUNT(*) FROM site_standard_articles WHERE verified = true) AS total_articles,
      (SELECT COUNT(DISTINCT author_did) FROM site_standard_articles WHERE verified = true) AS total_authors,
      (SELECT COUNT(DISTINCT site) FROM site_standard_articles WHERE verified = true AND site IS NOT NULL) AS total_sites,
      (SELECT COUNT(*) FROM site_standard_articles WHERE verified = true AND published_at > NOW() - INTERVAL '24 hours') AS articles_today
  `);

  return {
    totalArticles: Number(rows[0].total_articles),
    totalAuthors: Number(rows[0].total_authors),
    totalSites: Number(rows[0].total_sites),
    articlesToday: Number(rows[0].articles_today),
  };
}

// ── Topic Clusters (uses existing topic_clusters table) ──────────────────────

export async function getActiveTopicClusters(): Promise<TopicCluster[]> {
  const { rows } = await db.query(
    `SELECT id, label, article_count, track_ids
     FROM topic_clusters
     WHERE article_count > 0
     ORDER BY article_count DESC`,
  );
  return rows.map((r: any) => ({
    id: Number(r.id),
    label: r.label,
    article_count: Number(r.article_count),
    sample_uris: [],
  }));
}

/**
 * Distinct verified publication sites with article counts.
 */
export async function getPublicationSites(limit = 20): Promise<{ site: string; count: number }[]> {
  const { rows } = await db.query(
    `SELECT site, COUNT(*)::int AS count
     FROM site_standard_articles
     WHERE verified = true AND site IS NOT NULL AND suppressed IS NOT TRUE
     GROUP BY site
     ORDER BY count DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r: any) => ({ site: r.site, count: Number(r.count) }));
}

/**
 * Top authors by verified article count.
 */
export async function getTopAuthors(limit = 10): Promise<AuthorSummary[]> {
  const { rows } = await db.query(
    `SELECT
       a.author_did AS did,
       MAX(a.author_handle) AS handle,
       COUNT(*)::int AS article_count,
       COALESCE(SUM(lk.cnt), 0)::int AS total_likes,
       MAX(a.published_at) AS latest_published
     FROM site_standard_articles a
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS cnt FROM article_interactions
       WHERE article_uri = a.uri AND interaction_type = 'like'
     ) lk ON true
     WHERE a.verified = true AND a.suppressed IS NOT TRUE
     GROUP BY a.author_did
     ORDER BY article_count DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r: any) => ({
    did: r.did,
    handle: r.handle,
    article_count: Number(r.article_count),
    total_likes: Number(r.total_likes),
    latest_published: r.latest_published?.toISOString?.() ?? null,
  }));
}

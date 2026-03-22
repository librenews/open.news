import { db } from '../client.js';

export interface Article {
  id: bigint;
  url: string;
  canonical_url: string | null;
  title: string | null;
  description: string | null;
  image_url: string | null;
  author: string | null;
  published_at: Date | null;
  site_name: string | null;
  og_type: string | null;
  jsonld_type: string | null;
  news_score: number;
  is_news: boolean;
  fetch_status: string;
  fetch_error: string | null;
  fetched_at: Date | null;
  full_text: string | null;
  text_extracted_at: Date | null;
  word_count: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface ArticleWithSources extends Article {
  sources: { handle: string | null; display_name: string | null }[];
  seen_at: Date | null;
  saved_at: Date | null;
}

export async function findArticleByUrl(url: string): Promise<Article | null> {
  const { rows } = await db.query<Article>(
    'SELECT * FROM articles WHERE url = $1',
    [url]
  );
  return rows[0] ?? null;
}

export async function insertArticle(params: {
  url: string;
}): Promise<Article> {
  const { rows } = await db.query<Article>(
    `INSERT INTO articles (url) VALUES ($1)
     ON CONFLICT (url) DO UPDATE SET url = EXCLUDED.url
     RETURNING *`,
    [params.url]
  );
  return rows[0]!;
}

/** Update the url column — used after resolving a short URL to its final destination. */
export async function setArticleUrl(id: bigint | number, newUrl: string): Promise<void> {
  await db.query(
    `UPDATE articles SET url = $2, updated_at = NOW() WHERE id = $1`,
    [id, newUrl]
  );
}
export async function updateArticleMeta(
  id: bigint | number,
  params: {
    canonical_url?: string | null;
    title?: string | null;
    description?: string | null;
    image_url?: string | null;
    author?: string | null;
    published_at?: Date | null;
    site_name?: string | null;
    og_type?: string | null;
    jsonld_type?: string | null;
    news_score: number;
    is_news: boolean;
    fetch_status: string;
    fetch_error?: string | null;
    full_text?: string | null;
    word_count?: number | null;
  }
): Promise<void> {
  await db.query(
    `UPDATE articles SET
       canonical_url     = $2::text,
       title             = $3::text,
       description       = $4::text,
       image_url         = $5::text,
       author            = $6::text,
       published_at      = $7,
       site_name         = $8::text,
       og_type           = $9::text,
       jsonld_type       = $10::text,
       news_score        = $11,
       is_news           = $12,
       fetch_status      = $13::text,
       fetch_error       = $14::text,
       full_text         = $15::text,
       word_count        = $16,
       fetched_at        = NOW(),
       text_extracted_at = CASE WHEN $15::text IS NOT NULL THEN NOW() ELSE NULL END,
       updated_at        = NOW()
     WHERE id = $1`,
    [
      id,
      params.canonical_url ?? null,
      params.title ?? null,
      params.description ?? null,
      params.image_url ?? null,
      params.author ?? null,
      params.published_at ?? null,
      params.site_name ?? null,
      params.og_type ?? null,
      params.jsonld_type ?? null,
      params.news_score,
      params.is_news,
      params.fetch_status,
      params.fetch_error ?? null,
      params.full_text ?? null,
      params.word_count ?? null,
    ]
  );
}

export async function upsertArticleSource(
  articleId: bigint | number,
  sourceId: bigint | number,
  postUri?: string,
  postCid?: string
): Promise<void> {
  await db.query(
    `INSERT INTO article_sources (article_id, source_id, post_uri, post_cid)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (article_id, source_id) DO UPDATE SET
       post_uri = COALESCE(article_sources.post_uri, EXCLUDED.post_uri),
       post_cid = COALESCE(article_sources.post_cid, EXCLUDED.post_cid)`,
    [articleId, sourceId, postUri ?? null, postCid ?? null]
  );
}

export async function fanOutArticleToUsers(
  articleId: bigint | number,
  sourceDid: string
): Promise<void> {
  await db.query(
    `INSERT INTO user_articles (user_id, article_id)
     SELECT us.user_id, $1
     FROM user_sources us
     JOIN sources s ON s.id = us.source_id
     WHERE s.did = $2
     ON CONFLICT (user_id, article_id) DO NOTHING`,
    [articleId, sourceDid]
  );
}

export async function getArticlesForUser(
  userId: bigint | number,
  options: { before?: string; limit?: number; unreadOnly?: boolean }
): Promise<{ articles: ArticleWithSources[]; nextCursor: string | null }> {
  const limit = Math.min(options.limit ?? 20, 100);
  const params: unknown[] = [userId, limit + 1];
  let whereExtra = '';

  if (options.before) {
    params.push(options.before);
    whereExtra += ` AND ua.created_at < $${params.length}`;
  }
  if (options.unreadOnly) {
    whereExtra += ` AND ua.seen_at IS NULL`;
  }

  const { rows } = await db.query<
    Article & {
      seen_at: Date | null;
      saved_at: Date | null;
      ua_created_at: Date;
      sources: string; // JSON
    }
  >(
    `SELECT a.*,
            ua.seen_at,
            ua.saved_at,
            ua.created_at AS ua_created_at,
            (
              SELECT json_agg(src)
              FROM (
                SELECT json_build_object(
                  'handle', s.handle,
                  'display_name', s.display_name,
                  'avatar_url', s.avatar_url,
                  'post_uri', ars2.post_uri
                ) AS src
                FROM article_sources ars2
                JOIN sources s ON s.id = ars2.source_id
                WHERE ars2.article_id = a.id
                ORDER BY ars2.discovered_at ASC
              ) ordered_sources
            ) AS sources
     FROM user_articles ua
     JOIN articles a ON a.id = ua.article_id
     WHERE ua.user_id = $1
       AND a.is_news = TRUE
       ${whereExtra}
     ORDER BY ua.created_at DESC
     LIMIT $2`,
    params
  );

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;

  const articles: ArticleWithSources[] = slice.map((r) => ({
    ...r,
    // pg driver auto-parses json_agg into a JS array — no JSON.parse needed
    sources: Array.isArray(r.sources)
      ? r.sources
      : r.sources
        ? (JSON.parse(r.sources as unknown as string) ?? [])
        : [],
  }));

  const nextCursor = hasMore
    ? slice[slice.length - 1]!.ua_created_at.toISOString()
    : null;

  return { articles, nextCursor };
}

export async function markArticleSeen(
  userId: bigint | number,
  articleId: bigint | number
): Promise<void> {
  await db.query(
    `UPDATE user_articles SET seen_at = NOW()
     WHERE user_id = $1 AND article_id = $2 AND seen_at IS NULL`,
    [userId, articleId]
  );
}

/** Get recent unseen news articles for a user's briefing. */
export async function getUnseenArticlesForUser(
  userId: bigint | number,
  limit = 10
): Promise<{
  id: number;
  title: string;
  description: string | null;
  url: string;
  published_at: Date | null;
  site_name: string | null;
  image_url: string | null;
  text_excerpt: string | null;
}[]> {
  const { rows } = await db.query(
    `SELECT a.id, a.title, a.description, a.url, a.published_at,
            a.site_name, a.image_url,
            LEFT(a.full_text, 1500) AS text_excerpt
     FROM user_articles ua
     JOIN articles a ON a.id = ua.article_id
     WHERE ua.user_id = $1
       AND ua.seen_at IS NULL
       AND a.is_news = TRUE
       AND a.fetch_status = 'complete'
       AND a.title IS NOT NULL
     ORDER BY a.published_at DESC NULLS LAST, ua.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

/** Mark multiple articles as seen in bulk. */
export async function markArticlesSeen(
  userId: bigint | number,
  articleIds: (bigint | number)[]
): Promise<void> {
  if (articleIds.length === 0) return;
  await db.query(
    `UPDATE user_articles SET seen_at = NOW()
     WHERE user_id = $1 AND article_id = ANY($2) AND seen_at IS NULL`,
    [userId, articleIds]
  );
}

export async function toggleArticleSaved(
  userId: bigint | number,
  articleId: bigint | number
): Promise<void> {
  await db.query(
    `UPDATE user_articles
     SET saved_at = CASE WHEN saved_at IS NULL THEN NOW() ELSE NULL END
     WHERE user_id = $1 AND article_id = $2`,
    [userId, articleId]
  );
}

export async function getContextArticlesForUser(
  userId: bigint | number,
  query: string,
  limit = 5
): Promise<{ title: string | null; description: string | null; url: string; published_at: Date | null; text_excerpt: string | null }[]> {
  const { rows } = await db.query(
    `SELECT a.title, a.description, a.url, a.published_at,
            ts_rank(a.search_vector, q) AS rank,
            LEFT(a.full_text, 1500) AS text_excerpt
     FROM articles a
     JOIN user_articles ua ON ua.article_id = a.id
     JOIN plainto_tsquery('english', $1) q ON TRUE
     WHERE ua.user_id = $2
       AND a.is_news = TRUE
       AND a.search_vector @@ q
     ORDER BY rank DESC, a.published_at DESC
     LIMIT $3`,
    [query, userId, limit]
  );
  return rows;
}

export async function getContextArticlesPopular(
  query: string,
  limit = 5
): Promise<{ title: string | null; description: string | null; url: string; published_at: Date | null; text_excerpt: string | null }[]> {
  const { rows } = await db.query(
    `SELECT a.title, a.description, a.url, a.published_at,
            COUNT(ua.user_id) AS reader_count,
            LEFT(a.full_text, 1500) AS text_excerpt
     FROM articles a
     JOIN user_articles ua ON ua.article_id = a.id
     WHERE a.is_news = TRUE
       AND a.search_vector @@ plainto_tsquery('english', $1)
     GROUP BY a.id
     ORDER BY reader_count DESC, a.published_at DESC
     LIMIT $2`,
    [query, limit]
  );
  return rows;
}

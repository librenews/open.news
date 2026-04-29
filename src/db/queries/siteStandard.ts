import { db } from '../client.js';
import { logger } from '../../lib/logger.js';

export async function isSiteStandardDidKnown(did: string): Promise<boolean> {
  const { rows } = await db.query(
    'SELECT 1 FROM known_site_standard_dids WHERE did = $1',
    [did]
  );
  return rows.length > 0;
}

export async function markSiteStandardDidKnown(did: string): Promise<void> {
  await db.query(
    'INSERT INTO known_site_standard_dids (did) VALUES ($1) ON CONFLICT (did) DO NOTHING',
    [did]
  );
}

export async function upsertSiteStandardArticle(
  uri: string,
  authorDid: string,
  title: string | null,
  description: string | null,
  publishedAt: Date | null,
  site: string | null,
  path: string | null,
  rawRecord: any,
  language: string | null,
  wordCount: number
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO site_standard_articles (uri, author_did, title, description, published_at, site, path, raw_record, language, word_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (uri) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         published_at = EXCLUDED.published_at,
         site = EXCLUDED.site,
         path = EXCLUDED.path,
         raw_record = EXCLUDED.raw_record,
         language = EXCLUDED.language,
         word_count = EXCLUDED.word_count`,
      [uri, authorDid, title, description, publishedAt, site, path, rawRecord, language, wordCount]
    );
  } catch (err) {
    logger.error({ err, uri }, 'Failed to upsert site_standard_article');
    throw err;
  }
}

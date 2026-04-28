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
  publishedAt: Date | null
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO site_standard_articles (uri, author_did, title, description, published_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (uri) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         published_at = EXCLUDED.published_at`,
      [uri, authorDid, title, description, publishedAt]
    );
  } catch (err) {
    logger.error({ err, uri }, 'Failed to upsert site_standard_article');
    throw err;
  }
}

import { Job } from 'pg-boss';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { getNearbyBotDid } from '../nearby/bot.js';

interface SeedGeoFromDomainsData {
  batchSize?: number;
}

/**
 * Seeds nearby_geotags by matching site_standard_articles domains
 * against the nearby_domain_locations lookup table.
 *
 * Creates both 'document' geotags (for individual articles) and
 * 'account' geotags (for the author DID) from domain matches.
 */
export async function seedGeoFromDomainsJob(job: Job<SeedGeoFromDomainsData>) {
  const batchSize = job.data?.batchSize || 5000;
  const botDid = getNearbyBotDid();

  try {
    // Seed document-level geotags from domain matches
    const docResult = await db.query(`
      INSERT INTO nearby_geotags (tagger_did, subject, subject_type, place_id, confidence, source)
      SELECT DISTINCT
        $1,
        s.uri,
        'document',
        d.place_id,
        d.confidence,
        'domain_lookup'
      FROM site_standard_articles s
      JOIN nearby_domain_locations d
        ON REPLACE(REPLACE(s.site, 'https://', ''), 'http://', '') = d.domain
      WHERE s.site IS NOT NULL
        AND s.site LIKE 'http%'
      ON CONFLICT (subject, place_id, tagger_did) DO NOTHING
    `, [botDid]);

    logger.info({ inserted: docResult.rowCount }, 'Seeded document geotags from domains');

    // Seed account-level geotags from domain matches (unique author DIDs)
    const accountResult = await db.query(`
      INSERT INTO nearby_geotags (tagger_did, subject, subject_type, place_id, confidence, source)
      SELECT DISTINCT
        $1,
        s.author_did,
        'account',
        d.place_id,
        LEAST(d.confidence, 0.80),
        'domain_lookup'
      FROM site_standard_articles s
      JOIN nearby_domain_locations d
        ON REPLACE(REPLACE(s.site, 'https://', ''), 'http://', '') = d.domain
      WHERE s.site IS NOT NULL
        AND s.site LIKE 'http%'
      ON CONFLICT (subject, place_id, tagger_did) DO NOTHING
    `, [botDid]);

    logger.info({ inserted: accountResult.rowCount }, 'Seeded account geotags from domains');

    // Report totals
    const { rows: [totals] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE subject_type = 'document') AS documents,
        COUNT(*) FILTER (WHERE subject_type = 'account') AS accounts,
        COUNT(DISTINCT place_id) AS places
      FROM nearby_geotags
    `);

    logger.info({
      totalDocuments: totals.documents,
      totalAccounts: totals.accounts,
      totalPlaces: totals.places
    }, 'Geo seed complete');

  } catch (err: any) {
    logger.error({ err, message: err?.message, detail: err?.detail }, 'Failed to seed geotags from domains');
    throw err;
  }
}

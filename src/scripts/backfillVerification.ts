/**
 * Backfill verification status for existing articles and publications.
 *
 * Strategy (efficient → expensive):
 *  1. Verify all publications via .well-known (one HTTP call per domain)
 *  2. Bulk-mark all documents under verified publications (zero HTTP calls)
 *  3. For remaining unverified documents with HTTP site+path, check <link> tag
 *     (throttled, batched — most expensive but covers standalone documents)
 *
 * Usage: npx tsx src/scripts/backfillVerification.ts [--skip-documents]
 */

import { db } from '../db/client.js';
import { verifyPublication, verifyDocument } from '../lib/verification.js';
import { logger } from '../lib/logger.js';

const CONCURRENCY = 5;
const DELAY_MS = 200; // delay between batches to avoid hammering sites
const SKIP_DOCUMENTS = process.argv.includes('--skip-documents');

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function backfillPublications(): Promise<number> {
  console.log('── Phase 1: Verifying publications ──────────────────────────');
  const { rows } = await db.query(
    'SELECT uri, url FROM site_publications WHERE (verified IS NULL OR verified_at < NOW() - INTERVAL \'7 days\') AND url IS NOT NULL'
  );
  console.log(`  Found ${rows.length} publications to verify`);

  let verified = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (row: any) => {
        const result = await verifyPublication(row.uri, row.url);
        if (result) verified++;
        else failed++;
        return { uri: row.uri, url: row.url, verified: result };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.verified) {
        console.log(`  ✅ ${r.value.url}`);
      }
    }

    if (i + CONCURRENCY < rows.length) await sleep(DELAY_MS);
  }

  console.log(`  Publications: ${verified} verified, ${failed} unverified\n`);
  return verified;
}

async function cascadePublicationVerification(): Promise<number> {
  console.log('── Phase 2: Cascading publication verification to documents ─');

  // Find all verified publications
  const { rows: verifiedPubs } = await db.query(
    'SELECT uri, url FROM site_publications WHERE verified = true'
  );
  console.log(`  ${verifiedPubs.length} verified publications found`);

  let totalCascaded = 0;

  for (const pub of verifiedPubs) {
    // Extract the domain from the publication URL
    let domain: string;
    try {
      domain = new URL(pub.url).origin;
    } catch { continue; }

    // Match by AT-URI reference (documents that reference this publication)
    const { rowCount: byRef } = await db.query(
      `UPDATE site_standard_articles
       SET verified = true, verified_at = NOW()
       WHERE verified IS NULL
         AND raw_record->>'site' = $1`,
      [pub.uri]
    );

    // Match by domain (documents whose resolved site matches this publication's domain)
    const { rowCount: byDomain } = await db.query(
      `UPDATE site_standard_articles
       SET verified = true, verified_at = NOW()
       WHERE verified IS NULL
         AND site LIKE $1`,
      [domain + '%']
    );

    const count = (byRef || 0) + (byDomain || 0);
    if (count > 0) {
      console.log(`  📄 ${pub.url}: cascaded to ${count} documents`);
      totalCascaded += count;
    }
  }

  console.log(`  Total cascaded: ${totalCascaded} documents\n`);
  return totalCascaded;
}

async function backfillDocuments(): Promise<void> {
  console.log('── Phase 3: Per-document verification (throttled) ──────────');

  // Only check documents with HTTP sites that haven't been verified yet
  const { rows } = await db.query(
    `SELECT uri, site, path, raw_record->>'site' AS pub_uri
     FROM site_standard_articles
     WHERE verified IS NULL
       AND site IS NOT NULL AND site LIKE 'http%'
       AND path IS NOT NULL AND path != ''
     ORDER BY created_at DESC
     LIMIT 500`
  );
  console.log(`  ${rows.length} documents to check (capped at 500)`);

  let verified = 0;
  let unverified = 0;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (row: any) => {
        const result = await verifyDocument(row.uri, row.site, row.path, row.pub_uri);
        if (result) {
          verified++;
          await db.query(
            'UPDATE site_standard_articles SET verified = true, verified_at = NOW() WHERE uri = $1',
            [row.uri]
          );
        } else {
          unverified++;
          await db.query(
            'UPDATE site_standard_articles SET verified = false, verified_at = NOW() WHERE uri = $1',
            [row.uri]
          );
        }
        return result;
      })
    );

    // Progress
    if ((i + CONCURRENCY) % 50 === 0) {
      console.log(`  Progress: ${i + CONCURRENCY}/${rows.length} (${verified} verified)`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`  Documents: ${verified} verified, ${unverified} unverified\n`);
}

async function markBridgyfedUnverified(): Promise<number> {
  console.log('── Phase 0: Marking BridgyFed content as unverified ────────');
  const { rowCount } = await db.query(
    `UPDATE site_standard_articles
     SET verified = false, verified_at = NOW()
     WHERE verified IS NULL
       AND author_handle LIKE '%.web.brid.gy'`
  );
  const count = rowCount || 0;
  console.log(`  Marked ${count} BridgyFed articles as unverified\n`);
  return count;
}

async function main() {
  console.log('=== Backfill Verification ===\n');

  // Quick win: mark all bridgyfed as unverified immediately
  await markBridgyfedUnverified();

  // Phase 1: Verify publications
  await backfillPublications();

  // Phase 2: Cascade to documents
  await cascadePublicationVerification();

  // Phase 3: Per-document checks (optional, most expensive)
  if (!SKIP_DOCUMENTS) {
    await backfillDocuments();
  } else {
    console.log('── Phase 3: Skipped (--skip-documents flag) ──────────────\n');
  }

  // Summary
  const { rows: [summary] } = await db.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE verified = true) AS verified,
      COUNT(*) FILTER (WHERE verified = false) AS unverified,
      COUNT(*) FILTER (WHERE verified IS NULL) AS unchecked
    FROM site_standard_articles
  `);
  console.log('=== Summary ===');
  console.log(`  Total articles:  ${summary.total}`);
  console.log(`  ✅ Verified:     ${summary.verified}`);
  console.log(`  ❌ Unverified:   ${summary.unverified}`);
  console.log(`  ⏳ Unchecked:    ${summary.unchecked}`);

  process.exit(0);
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

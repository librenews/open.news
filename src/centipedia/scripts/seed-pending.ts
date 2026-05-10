/**
 * Seed pending citations for agent testing.
 * Usage: node --env-file=.env --import tsx/esm src/centipedia/scripts/seed-pending.ts
 */
import pg from 'pg';
const { Pool } = pg;

const db = new Pool({ connectionString: process.env.DATABASE_URL });

const pendingCitations = [
  { url: 'https://blueskyweb.xyz/blog/2-22-2024-open-social-web', topic: null, excerpt: null },
  { url: 'https://atproto.com/specs/did', topic: null, excerpt: null },
  { url: 'https://atproto.com/specs/lexicon', topic: null, excerpt: null },
];

async function main() {
  for (const c of pendingCitations) {
    await db.query(
      `INSERT INTO centipedia_citations (url, submitted_by, topic, excerpt, status, created_at)
       VALUES ($1, 'did:plc:srdudtvbpm5ck3i4mjdoasdy', $2, $3, 'pending', NOW())
       ON CONFLICT DO NOTHING`,
      [c.url, c.topic, c.excerpt]
    );
    console.log(`⏳ ${c.url}`);
  }
  console.log('\n✅ Seeded pending citations for agent testing');
  await db.end();
}

main().catch(console.error);

/**
 * Seed mock citations linked to the test article.
 * Usage: node --env-file=.env --import tsx/esm src/centipedia/scripts/seed-citations.ts
 */
import pg from 'pg';
const { Pool } = pg;

const db = new Pool({ connectionString: process.env.DATABASE_URL });

const ARTICLE_RKEY = 'at-protocol-decentralization';

const citations = [
  {
    url: 'https://atproto.com/guides/overview',
    title: 'AT Protocol Overview',
    topic: 'AT Protocol',
    excerpt: 'Official overview of the Authenticated Transfer Protocol architecture, including DIDs, lexicons, and data repositories.',
    submitted_by: 'did:plc:srdudtvbpm5ck3i4mjdoasdy', // centipedia bot
    status: 'accepted',
  },
  {
    url: 'https://blueskyweb.xyz/blog/3-6-2022-a-self-authenticating-social-protocol',
    title: 'A Self-Authenticating Social Protocol',
    topic: 'AT Protocol',
    excerpt: 'Jay Graber\'s foundational blog post describing the vision for a self-authenticating social protocol that would become AT Protocol.',
    submitted_by: 'did:plc:srdudtvbpm5ck3i4mjdoasdy',
    status: 'accepted',
  },
  {
    url: 'https://en.wikipedia.org/wiki/Decentralized_identifier',
    title: 'Decentralized Identifier — Wikipedia',
    topic: 'Decentralization',
    excerpt: 'Overview of the W3C DID specification that AT Protocol builds upon for portable identity.',
    submitted_by: null, // anonymous
    status: 'accepted',
  },
  {
    url: 'https://www.w3.org/TR/did-core/',
    title: 'W3C DID Core Specification',
    topic: 'Decentralization',
    excerpt: 'The formal specification for Decentralized Identifiers (DIDs), the identity layer underlying AT Protocol.',
    submitted_by: 'did:plc:srdudtvbpm5ck3i4mjdoasdy',
    status: 'accepted',
  },
  {
    url: 'https://arxiv.org/abs/2301.12345',
    title: 'Trust Networks in Decentralized Systems',
    topic: 'Trust Networks',
    excerpt: 'Research paper analyzing trust propagation models in decentralized social networks, relevant to endorsement graph design.',
    submitted_by: null,
    status: 'pending',
  },
];

async function main() {
  for (const c of citations) {
    await db.query(
      `INSERT INTO centipedia_citations (url, title, submitted_by, topic, excerpt, article_rkey, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - interval '1 hour' * (random() * 48)::int)
       ON CONFLICT DO NOTHING`,
      [c.url, c.title, c.submitted_by, c.topic, c.excerpt, ARTICLE_RKEY, c.status]
    );
    console.log(`✅ ${c.title}`);
  }

  // Add some endorsements
  const { rows: citRows } = await db.query(
    'SELECT id FROM centipedia_citations WHERE article_rkey = $1 AND status = $2 LIMIT 3',
    [ARTICLE_RKEY, 'accepted']
  );
  for (const row of citRows) {
    await db.query(
      `INSERT INTO centipedia_endorsement_citations (did, citation_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      ['did:plc:srdudtvbpm5ck3i4mjdoasdy', row.id]
    );
  }
  console.log(`\n✅ Seeded ${citations.length} citations and endorsements for article: ${ARTICLE_RKEY}`);
  await db.end();
}

main().catch(console.error);

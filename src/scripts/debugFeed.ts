/**
 * Diagnostic script: checks doc_feed_bridge state and subscription resolution.
 * 
 * Usage: node --env-file=.env --import tsx/esm src/scripts/debugFeed.ts [your-did]
 */
import { db } from '../db/client.js';
import { BskyAgent } from '@atproto/api';
import { resolvePds } from '../lib/pds.js';

async function main() {
  const myDid = process.argv[2];

  // 1. Check bridge table
  const { rows: bridgeRows } = await db.query('SELECT COUNT(*) as count FROM doc_feed_bridge');
  console.log(`\n📊 doc_feed_bridge: ${bridgeRows[0].count} entries`);

  const { rows: sample } = await db.query(`
    SELECT b.doc_uri, b.post_uri, b.source, a.title, a.raw_record->>'site' as pub_uri, a.verified
    FROM doc_feed_bridge b
    JOIN site_standard_articles a ON a.uri = b.doc_uri
    ORDER BY b.created_at DESC LIMIT 5
  `);
  if (sample.length > 0) {
    console.log(`\n  Recent bridge entries:`);
    for (const s of sample) {
      console.log(`    [${s.source}] ${s.title?.substring(0, 50)} | verified=${s.verified} | pub=${s.pub_uri?.substring(0, 50)}`);
    }
  }

  // 2. Check how many verified articles have bskyPostRef
  const { rows: withRef } = await db.query(`
    SELECT COUNT(*) as count FROM site_standard_articles
    WHERE verified = true AND raw_record->'bskyPostRef'->>'uri' IS NOT NULL
  `);
  console.log(`\n📊 Verified articles with bskyPostRef: ${withRef[0].count}`);

  // 3. Check verified articles total
  const { rows: verifiedCount } = await db.query(`
    SELECT COUNT(*) as count FROM site_standard_articles WHERE verified = true
  `);
  console.log(`📊 Total verified articles: ${verifiedCount[0].count}`);

  // 4. If DID provided, check subscriptions
  if (myDid) {
    console.log(`\n👤 Checking subscriptions for: ${myDid}`);
    try {
      const pds = await resolvePds(myDid);
      console.log(`   PDS: ${pds}`);
      const agent = new BskyAgent({ service: pds! });
      const res = await agent.com.atproto.repo.listRecords({
        repo: myDid,
        collection: 'site.standard.graph.subscription',
        limit: 100,
      });
      console.log(`   Subscriptions: ${res.data.records.length}`);
      for (const r of res.data.records) {
        const val = r.value as any;
        const pubUri = val?.publication;
        console.log(`     → ${pubUri}`);

        // Check if we have bridge entries for this publication
        const { rows: pubBridge } = await db.query(`
          SELECT COUNT(*) as count FROM doc_feed_bridge b
          JOIN site_standard_articles a ON a.uri = b.doc_uri
          WHERE a.raw_record->>'site' = $1 AND a.verified = true
        `, [pubUri]);
        console.log(`       Bridge entries: ${pubBridge[0].count}`);
      }
    } catch (err: any) {
      console.log(`   ❌ Error: ${err.message}`);
    }
  } else {
    console.log(`\n💡 Pass your DID as argument to check subscriptions:`);
    console.log(`   node --env-file=.env --import tsx/esm src/scripts/debugFeed.ts did:plc:yourDID`);
  }

  await db.end();
}

main().catch(console.error);

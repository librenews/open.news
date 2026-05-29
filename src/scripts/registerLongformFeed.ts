/**
 * One-time script to register the "Longform Subscriptions" feed generator
 * record on the Longform bot's Bluesky account.
 *
 * Usage: npx tsx src/scripts/registerLongformFeed.ts
 *
 * The record lives in the bot's repo but points to did:web:longform.social
 * as the service endpoint where Bluesky sends getFeedSkeleton requests.
 */
import { BskyAgent } from '@atproto/api';
import { config } from '../lib/config.js';

async function main() {
  if (!config.LONGFORM_BOT_DID || !config.LONGFORM_BOT_PASSWORD) {
    console.error('❌ LONGFORM_BOT_DID and LONGFORM_BOT_PASSWORD must be set');
    process.exit(1);
  }

  const agent = new BskyAgent({ service: config.ATPROTO_PDS_URL });
  await agent.login({
    identifier: config.LONGFORM_BOT_DID,
    password: config.LONGFORM_BOT_PASSWORD,
  });
  console.log(`✅ Logged in as ${config.LONGFORM_BOT_DID}`);

  const feedDid = `did:web:${config.LONGFORM_DOMAIN}`;
  const rkey = 'subscriptions';

  const res = await agent.com.atproto.repo.putRecord({
    repo: config.LONGFORM_BOT_DID,
    collection: 'app.bsky.feed.generator',
    rkey,
    record: {
      $type: 'app.bsky.feed.generator',
      did: feedDid,
      displayName: 'Longform Subscriptions',
      description:
        'Articles from Standard Site publications you subscribe to. No setup needed — uses your existing subscriptions.',
      createdAt: new Date().toISOString(),
    },
  });

  console.log(`\n✅ Feed generator registered!`);
  console.log(`   URI:  ${res.data.uri}`);
  console.log(`   CID:  ${res.data.cid}`);
  console.log(`   DID:  ${feedDid}`);
  console.log(`\n📌 Users can find it at:`);
  console.log(`   https://bsky.app/profile/${config.LONGFORM_BOT_DID}/feed/${rkey}`);
}

main().catch((err) => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});

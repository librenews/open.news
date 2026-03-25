/**
 * Delete the Track Matches feed generator record from Bluesky.
 *
 * Usage:
 *   TRACK_BSKY_HANDLE=track.social \
 *   TRACK_BSKY_PASSWORD=xxxx \
 *   npx tsx src/track/deleteFeed.ts
 */

import { AtpAgent } from '@atproto/api';

const HANDLE = process.env.TRACK_BSKY_HANDLE;
const PASSWORD = process.env.TRACK_BSKY_PASSWORD;
const RECORD_NAME = 'track-matches';

if (!HANDLE || !PASSWORD) {
  console.error('Set TRACK_BSKY_HANDLE and TRACK_BSKY_PASSWORD env vars');
  process.exit(1);
}

async function main() {
  const agent = new AtpAgent({ service: 'https://bsky.social' });
  await agent.login({ identifier: HANDLE!, password: PASSWORD! });
  console.log(`Logged in as ${agent.session?.did}`);

  try {
    await agent.api.app.bsky.feed.generator.delete(
      { repo: agent.session!.did, rkey: RECORD_NAME },
    );
    console.log(`✅ Feed "${RECORD_NAME}" deleted.`);
    console.log('You can republish anytime with: npx tsx src/track/publishFeed.ts');
  } catch (err: any) {
    if (err?.message?.includes('not found') || err?.status === 404) {
      console.log('Feed record not found — nothing to delete.');
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error('Failed to delete feed:', err);
  process.exit(1);
});

/**
 * One-time script to publish the Track Matches feed generator to Bluesky.
 *
 * Usage:
 *   TRACK_BSKY_HANDLE=track.social.bsky.social \
 *   TRACK_BSKY_PASSWORD=xxxx \
 *   npx tsx src/track/publishFeed.ts
 *
 * This creates an `app.bsky.feed.generator` record in the track.social account
 * pointing to did:web:track.social as the feed generator service.
 */

import { AtpAgent, BlobRef } from '@atproto/api';
import * as fs from 'fs';
import * as path from 'path';

const HANDLE = process.env.TRACK_BSKY_HANDLE;
const PASSWORD = process.env.TRACK_BSKY_PASSWORD;
const FEED_GEN_DID = 'did:web:track.social';
const RECORD_NAME = 'track-matches';

if (!HANDLE || !PASSWORD) {
  console.error('Set TRACK_BSKY_HANDLE and TRACK_BSKY_PASSWORD env vars');
  process.exit(1);
}

async function main() {
  const agent = new AtpAgent({ service: 'https://bsky.social' });
  await agent.login({ identifier: HANDLE!, password: PASSWORD! });
  console.log(`Logged in as ${agent.session?.did}`);

  // Upload avatar if we have the logo
  let avatarRef: BlobRef | undefined;
  const logoPath = path.join(import.meta.dirname, 'public', 'favicon.png');
  if (fs.existsSync(logoPath)) {
    const logoData = fs.readFileSync(logoPath);
    const uploadRes = await agent.uploadBlob(logoData, { encoding: 'image/png' });
    avatarRef = uploadRes.data.blob;
    console.log('Uploaded avatar');
  }

  // Create the feed generator record
  const record: Record<string, unknown> = {
    did: FEED_GEN_DID,
    displayName: 'Track',
    description: 'Posts matching your Tracks — powered by semantic AI search on the Bluesky firehose. Set up your tracks at track.social.',
    createdAt: new Date().toISOString(),
  };

  if (avatarRef) {
    record.avatar = avatarRef;
  }

  try {
    await agent.api.app.bsky.feed.generator.create(
      { repo: agent.session!.did, rkey: RECORD_NAME },
      record as any,
    );
    console.log(`\n✅ Feed published!`);
    console.log(`Feed URI: at://${agent.session!.did}/app.bsky.feed.generator/${RECORD_NAME}`);
    console.log(`\nUsers can find it by searching "Track Matches" in Bluesky,`);
    console.log(`or you can share the link directly.`);
  } catch (err: any) {
    if (err?.message?.includes('duplicate')) {
      // Update existing record
      await agent.api.app.bsky.feed.generator.delete(
        { repo: agent.session!.did, rkey: RECORD_NAME },
      );
      await agent.api.app.bsky.feed.generator.create(
        { repo: agent.session!.did, rkey: RECORD_NAME },
        record as any,
      );
      console.log(`\n✅ Feed updated!`);
      console.log(`Feed URI: at://${agent.session!.did}/app.bsky.feed.generator/${RECORD_NAME}`);
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error('Failed to publish feed:', err);
  process.exit(1);
});

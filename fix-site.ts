// Fix publication record: use 'name' instead of 'title', add preferences
// Usage: BSKY_HANDLE=librenews.bsky.social BSKY_APP_PASSWORD=xxxx npx tsx fix-site.ts

import { BskyAgent } from '@atproto/api';

const HANDLE = process.env.BSKY_HANDLE;
const PASSWORD = process.env.BSKY_APP_PASSWORD;
const DID = 'did:plc:ticz2qmqh2vqxnehf5zalkpl';

async function main() {
  if (!HANDLE || !PASSWORD) {
    console.error('Set BSKY_HANDLE and BSKY_APP_PASSWORD env vars');
    process.exit(1);
  }

  const agent = new BskyAgent({ service: 'https://bsky.social' });
  await agent.login({ identifier: HANDLE, password: PASSWORD });
  console.log('Logged in as', HANDLE);

  const res = await agent.com.atproto.repo.putRecord({
    repo: DID,
    collection: 'site.standard.publication',
    rkey: 'self',
    record: {
      $type: 'site.standard.publication',
      name: 'Libre News',
      description: '',
      url: 'https://longform.social',
      createdAt: new Date().toISOString(),
      preferences: {
        showComments: true,
        showMentions: true,
        showPrevNext: true,
        showInDiscover: true,
        showRecommends: true,
      },
    },
  });
  console.log('✅ Publication updated! URI:', res.data.uri);
}

main().catch(err => { console.error('Failed:', err.message); process.exit(1); });

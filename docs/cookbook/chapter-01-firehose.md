# Chapter 1: Drinking from the Firehose

The lifeblood of the AT Protocol is the **Firehose**. Unlike legacy social networks that lock their data behind rate-limited APIs, the AT Protocol broadcasts every single action—every post, like, repost, and follow—in real-time over a public WebSocket.

If you are building an algorithmic feed, an analytics dashboard, or a moderation bot, the firehose is your starting point.

## 1.1 The Architecture of the Firehose

The firehose is a standard WebSocket connection. However, the data sent over this socket is not plain JSON. For extreme efficiency, the AT Protocol uses **CBOR** (Concise Binary Object Representation) to pack the data tightly.

To consume the firehose, you need to:
1. Open a WebSocket connection to `wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos`.
2. Listen for binary messages.
3. Decode the binary buffer into a CBOR object.
4. Iterate through the "blocks" inside the message to find the actual database records.

## 1.2 Setting Up the Connection (TypeScript)

Let's build a production-grade firehose consumer in Node.js. 

First, you will need a few standard dependencies. `ws` handles the WebSocket connection, and `@atproto/api` (specifically the `Subscription` module) provides helpers to decode the CBOR frames effortlessly.

```bash
npm install ws @atproto/api
```

Here is the boilerplate to establish a resilient connection:

```typescript
import { Subscription } from '@atproto/xrpc-server';
import { cborToLexRecord } from '@atproto/repo';
import WebSocket from 'ws';

const FIREHOSE_URL = 'wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos';

async function startFirehose() {
  console.log(`Connecting to firehose at ${FIREHOSE_URL}...`);
  
  const sub = new Subscription({
    service: FIREHOSE_URL,
    method: 'com.atproto.sync.subscribeRepos',
    getBuffer: () => {
      // In production, you would fetch the last processed cursor from your database here
      // return lastCursor;
      return undefined;
    },
    validate: (value: any) => {
      return value;
    }
  });

  try {
    for await (const evt of sub) {
      processEvent(evt);
    }
  } catch (err) {
    console.error('Firehose connection dropped:', err);
    // Add exponential backoff reconnection logic here
  }
}

startFirehose();
```

## 1.3 Decoding the Payload

The `evt` object yielded by the `Subscription` iterator is a raw repository commit. A single commit can contain multiple database operations (creates, updates, deletes).

To get the actual data (like the text of a post), we must parse the `blocks` buffer into a map, and then iterate over the `ops` (operations).

```typescript
import { CarReader } from '@ipld/car';

async function processEvent(evt: any) {
  // We only care about "commit" events (which indicate a database change)
  if (evt.$type !== 'com.atproto.sync.subscribeRepos#commit') {
    return;
  }

  // A commit contains a CAR (Content Addressable aRchive) file.
  // We must read this binary block archive to access the data.
  const car = await CarReader.fromBytes(evt.blocks);
  const blockMap = new Map();
  for await (const block of car.blocks()) {
    blockMap.set(block.cid.toString(), block.bytes);
  }

  // Iterate over every operation in this commit
  for (const op of evt.ops) {
    // We only care about new records being created
    if (op.action !== 'create') continue;

    // We only care about Bluesky Posts
    if (op.path.startsWith('app.bsky.feed.post')) {
      const cid = op.cid.toString();
      const rawBytes = blockMap.get(cid);
      
      if (!rawBytes) continue;

      // Decode the raw CBOR bytes into a readable JSON record
      const record = cborToLexRecord(rawBytes) as any;
      
      console.log(`New Post from ${evt.repo}: ${record.text}`);
    }
  }
}
```

## 1.4 Identifying Other Record Types

The `op.path` string is the key to routing data. The AT Protocol is a collection of different "Lexicons" (schemas). By inspecting the path, you can identify exactly what action the user just took:

- **Posts**: `app.bsky.feed.post/`
- **Likes**: `app.bsky.feed.like/`
- **Reposts**: `app.bsky.feed.repost/`
- **Follows**: `app.bsky.graph.follow/`

### Example: Tracking Likes
If you wanted to track when a specific post gets liked, you would change your filter:

```typescript
if (op.path.startsWith('app.bsky.feed.like')) {
  const record = cborToLexRecord(blockMap.get(op.cid.toString())) as any;
  
  // The record.subject.uri contains the AT-URI of the post that was liked
  console.log(`${evt.repo} liked post: ${record.subject.uri}`);
}
```

## 1.5 Managing Cursors (Production Advice)

In the examples above, we return `undefined` for the `getBuffer` cursor. This means the firehose will start streaming from "right now".

If your server crashes and restarts, you will miss all the events that occurred while it was offline. To fix this, the firehose provides a `seq` (sequence) number with every event. 

**Best Practice:**
1. Every time you process an event, save `evt.seq` to Redis or your database.
2. When your server restarts, pass that saved `seq` number into the `getBuffer` parameter.
3. The relay server will automatically "catch you up" by instantly sending you every event you missed since that sequence number, before resuming real-time streaming!

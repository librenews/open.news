import WebSocket from 'ws';
import { db } from '../db/client.js';
import { getAllSourceDids, touchSourceLastSeen } from '../db/queries/sources.js';
import { findArticleByUrl, insertArticle, upsertArticleSource, fanOutArticleToUsers } from '../db/queries/articles.js';
import { normalizeArticleUrl, extractUrlsFromPost } from '../lib/urls.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { enqueueJob } from '../web/jobEnqueue.js';

const CURSOR_PERSIST_INTERVAL_MS = 30_000;
const DID_REFRESH_INTERVAL_MS = 60_000;
const BOT_DID = config.BSKY_BOT_DID;

let currentCursor: bigint | null = null;
let watchedDids: Set<string> = new Set();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Stats ───────────────────────────────────────────────────────────────────
const stats = { events: 0, posts: 0, mentions: 0, urlsFound: 0, jobsQueued: 0 };
const STATS_LOG_INTERVAL_MS = 30_000;

// ─── Cursor persistence ───────────────────────────────────────────────────────

async function loadCursor(): Promise<bigint | null> {
  const { rows } = await db.query<{ cursor: string | null }>(
    'SELECT cursor FROM jetstream_cursor WHERE id = 1'
  );
  const val = rows[0]?.cursor;
  return val != null ? BigInt(val) : null;
}

async function saveCursor(cursor: bigint): Promise<void> {
  await db.query(
    'UPDATE jetstream_cursor SET cursor = $1, updated_at = NOW() WHERE id = 1',
    [cursor.toString()]
  );
}

// ─── Jetstream connection ─────────────────────────────────────────────────────

// Jetstream URL limit is ~8KB. Each wantedDids param is ~45 chars, so cap at ~175.
// Above the threshold, omit wantedDids and filter client-side (handleEvent already does this).
const MAX_WANTED_DIDS = 175;

function buildJetstreamUrl(dids: string[], cursor: bigint | null): string {
  const params = new URLSearchParams();
  if (dids.length <= MAX_WANTED_DIDS) {
    for (const did of dids) {
      params.append('wantedDids', did);
    }
  }
  if (cursor) params.set('cursor', cursor.toString());
  const qs = params.toString();
  return `${config.JETSTREAM_URL}${qs ? '?' + qs : ''}`;
}

function connect() {
  if (ws) {
    try { ws.terminate(); } catch {}
    ws = null;
  }

  const url = buildJetstreamUrl([...watchedDids], currentCursor);
  logger.info({ dids: watchedDids.size, cursor: currentCursor }, 'Connecting to Jetstream');

  const socket = new WebSocket(url);
  ws = socket;

  socket.on('open', () => {
    logger.info('Jetstream connected');
  });

  socket.on('message', (data) => {
    stats.events++;
    try {
      const event = JSON.parse(data.toString()) as JetstreamEvent;
      if (event.time_us) currentCursor = BigInt(event.time_us);
      handleEvent(event).catch((err) =>
        logger.error({ err }, 'Error handling Jetstream event')
      );
    } catch (err) {
      logger.debug({ err }, 'Failed to parse Jetstream message');
    }
  });

  socket.on('close', () => {
    logger.warn('Jetstream disconnected, reconnecting in 5s');
    reconnectTimer = setTimeout(() => connect(), 5_000);
  });

  socket.on('error', (err) => {
    logger.error({ err }, 'Jetstream WebSocket error');
  });
}

// ─── Event handling ───────────────────────────────────────────────────────────

interface JetstreamEvent {
  kind: string;
  did: string;
  time_us?: number;
  commit?: {
    operation: string;
    collection: string;
    uri?: string;
    cid?: string;
    record?: Record<string, unknown>;
  };
}

async function handleEvent(event: JetstreamEvent): Promise<void> {
  if (event.kind !== 'commit') return;
  if (event.commit?.operation === 'delete') return;

  const { commit, did } = event;
  if (!commit) return;

  // ── Follow-as-signup ──────────────────────────────────────────────────────
  if (commit.collection === 'app.bsky.graph.follow') {
    const subject = (commit.record?.subject as string | undefined);
    if (subject === BOT_DID) {
      await enqueueJob('followSignup', { followerDid: did });
    }
    return;
  }

  // ── Bot mention/DM detection ──────────────────────────────────────────────
  if (commit.collection === 'app.bsky.feed.post' && commit.record) {
    const post = commit.record;
    const isMention = Array.isArray(post.facets) &&
      (post.facets as { features: { $type: string; did?: string }[] }[])
        .flatMap((f) => f.features)
        .some((f) => f.$type === 'app.bsky.richtext.facet#mention' && f.did === BOT_DID);

    if (isMention) {
      stats.mentions++;
      logger.debug({ did, uri: commit.uri }, 'Bot mention detected');
      await enqueueJob('botReply', {
        postUri: commit.uri ?? '',
        postCid: commit.cid ?? '',
        senderDid: did,
        text: (post.text as string) ?? '',
        interactionType: 'mention',
      });
      return;
    }

    // ── URL extraction ──────────────────────────────────────────────────────
    if (watchedDids.has(did)) {
      stats.posts++;
      await touchSourceLastSeen(did);

      const urls = extractUrlsFromPost(post as Parameters<typeof extractUrlsFromPost>[0]);
      for (const rawUrl of urls) {
        const url = normalizeArticleUrl(rawUrl);
        if (!url) continue;
        stats.urlsFound++;

        const existing = await findArticleByUrl(url);
        if (existing) {
          const { rows } = await db.query<{ id: string }>(
            `SELECT id FROM sources WHERE did = $1 AND type = 'bluesky'`, [did]
          );
          if (rows[0]) {
            await upsertArticleSource(existing.id, BigInt(rows[0].id), commit.uri, commit.cid);
            await fanOutArticleToUsers(existing.id, did);
          }
          continue;
        }

        stats.jobsQueued++;
        logger.debug({ url, did }, 'Enqueueing fetchArticle');
        await enqueueJob('fetchArticle', {
          url,
          sourceDid: did,
          postUri: commit.uri ?? '',
          postCid: commit.cid ?? '',
        });
      }
    }
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────

async function start() {
  currentCursor = await loadCursor();
  watchedDids = new Set(await getAllSourceDids());

  connect();

  // Persist cursor every 30s
  setInterval(async () => {
    if (currentCursor) {
      try { await saveCursor(currentCursor); } catch (err) {
        logger.error({ err }, 'Failed to save cursor');
      }
    }
  }, CURSOR_PERSIST_INTERVAL_MS);

  // Heartbeat: log stats every 30s
  setInterval(() => {
    logger.info(
      { ...stats, watchedDids: watchedDids.size, cursor: currentCursor?.toString() },
      'Firehose heartbeat'
    );
  }, STATS_LOG_INTERVAL_MS);

  // Refresh DID list every 60s and reconnect if changed
  setInterval(async () => {
    const newDids = new Set(await getAllSourceDids());
    const changed =
      newDids.size !== watchedDids.size ||
      [...newDids].some((d) => !watchedDids.has(d));
    if (changed) {
      logger.info({ before: watchedDids.size, after: newDids.size }, 'DID list changed, reconnecting');
      watchedDids = newDids;
      connect();
    }
  }, DID_REFRESH_INTERVAL_MS);

  logger.info({ cursor: currentCursor, dids: watchedDids.size }, 'Firehose consumer started');
}

start().catch((err) => {
  logger.error({ err }, 'Firehose startup failed');
  process.exit(1);
});

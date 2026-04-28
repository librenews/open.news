import WebSocket from 'ws';
import { db } from '../db/client.js';
import { isSiteStandardDidKnown, markSiteStandardDidKnown } from '../db/queries/siteStandard.js';
import { getAllSourceDids } from '../db/queries/sources.js';
import { deleteTrackMatchByPostUri } from '../db/queries/tracks.js';
import { normalizeArticleUrl, extractUrlsFromPost } from '../lib/urls.js';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { enqueueJob } from '../web/jobEnqueue.js';
import { xaddPost } from '../lib/redis.js';
import { logModeration } from '../db/queries/moderation.js';

const CURSOR_PERSIST_INTERVAL_MS = 30_000;
const DID_REFRESH_INTERVAL_MS = 60_000;
const BOT_DID = config.BSKY_BOT_DID;

let currentCursor: bigint | null = null;
let watchedDids: Set<string> = new Set();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let intentionalClose = false; // prevents ghost reconnect from old socket's close event
let lastConnectTime = Date.now();

// ─── Stats ───────────────────────────────────────────────────────────────────
const stats = { events: 0, posts: 0, mentions: 0, urlsFound: 0, jobsQueued: 0, lruHits: 0 };
let lastEventTimeUs: bigint | null = null;  // microsecond timestamp of most recent event
const STATS_LOG_INTERVAL_MS = 30_000;

// ─── LRU URL cache ──────────────────────────────────────────────────────────
// Avoids enqueuing duplicate jobs for the same URL within a short window.
// Pure in-memory — no DB queries. The worker still does its own dedup check.
const URL_LRU_MAX = 10_000;
const recentUrls = new Map<string, number>(); // url → timestamp

function isRecentlySeen(url: string): boolean {
  if (recentUrls.has(url)) {
    stats.lruHits++;
    return true;
  }
  recentUrls.set(url, Date.now());
  // Evict oldest entries when over capacity
  if (recentUrls.size > URL_LRU_MAX) {
    const firstKey = recentUrls.keys().next().value;
    if (firstKey) recentUrls.delete(firstKey);
  }
  return false;
}

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
  lastConnectTime = Date.now();
  // Clear any pending reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Tear down old socket without triggering a ghost reconnect
  if (ws) {
    intentionalClose = true;
    try { ws.terminate(); } catch {}
    ws = null;
  }

  const url = buildJetstreamUrl([...watchedDids], currentCursor);
  logger.info({ dids: watchedDids.size, cursor: currentCursor }, 'Connecting to Jetstream');

  const socket = new WebSocket(url);
  ws = socket;

  socket.on('open', () => {
    intentionalClose = false;
    logger.info('Jetstream connected');
  });

  socket.on('message', (data) => {
    stats.events++;
    try {
      const event = JSON.parse(data.toString()) as JetstreamEvent;
      if (event.time_us) {
        currentCursor = BigInt(event.time_us);
        lastEventTimeUs = currentCursor;
      }
      handleEvent(event);
    } catch (err) {
      logger.debug({ err }, 'Failed to parse Jetstream message');
    }
  });

  socket.on('close', (code, reason) => {
    // If this close was triggered by our own connect() call, don't reconnect
    if (intentionalClose) {
      intentionalClose = false;
      return;
    }
    logger.warn(
      { code, reason: reason?.toString() },
      'Jetstream disconnected, reconnecting in 5s'
    );
    reconnectTimer = setTimeout(() => connect(), 5_000);
  });

  socket.on('error', (err) => {
    logger.error({ err }, 'Jetstream WebSocket error');
  });
}

// ─── Event handling (zero DB queries — parse, extract, enqueue) ──────────────

interface JetstreamEvent {
  kind: string;
  did: string;
  time_us?: number;
  commit?: {
    operation: string;
    collection: string;
    rkey?: string;
    cid?: string;
    record?: Record<string, unknown>;
  };
}

function handleEvent(event: JetstreamEvent): void {
  if (event.kind !== 'commit') return;

  const { commit, did } = event;
  if (!commit) return;

  // Build AT URI from event components (Jetstream doesn't provide pre-built uri)
  const postUri = commit.rkey ? `at://${did}/${commit.collection}/${commit.rkey}` : '';

  if (commit.operation === 'delete') {
    if (commit.collection === 'app.bsky.feed.post' && postUri) {
      deleteTrackMatchByPostUri(postUri).then((deleted) => {
        if (deleted) {
          logModeration(did, postUri, 'bluesky_delete').catch(err => {
            logger.error({ err, postUri }, 'Failed to log bluesky_delete event');
          });
        }
      }).catch((err) => {
        logger.error({ err, postUri }, 'Failed to delete moderated post from DB');
      });
    }
    return;
  }

  // ── Follow-as-signup ──────────────────────────────────────────────────────
  if (commit.collection === 'app.bsky.graph.follow') {
    const subject = (commit.record?.subject as string | undefined);
    if (subject === BOT_DID) {
      enqueueJob('followSignup', { followerDid: did });
    }
    return;
  }

  // ── site.standard.document ingestion ──────────────────────────────────────────
  if (commit.collection === 'site.standard.document' && commit.record) {
    // 1. Enqueue indexing job for this specific post
    enqueueJob('indexSiteStandard', {
      postUri,
      did,
      record: commit.record
    });

    // 2. Check if we've seen this author before. If not, trigger a full backfill.
    // (We use a fire-and-forget catch to avoid blocking the firehose loop)
    isSiteStandardDidKnown(did).then(isKnown => {
      if (!isKnown) {
        markSiteStandardDidKnown(did).then(() => {
          logger.info({ did }, 'Discovered new site.standard.document author, triggering backfill');
          enqueueJob('backfillSiteStandard', { did });
        });
      }
    }).catch(err => {
      logger.error({ err, did }, 'Failed to check known site standard DIDs');
    });

    return;
  }

  // ── Posts: bot mentions + URL extraction + track stream ─────────────────────
  if (commit.collection !== 'app.bsky.feed.post' || !commit.record) return;

  const post = commit.record;

  // Push every post to Redis stream for track matching (fire-and-forget)
  const langs = Array.isArray(post.langs) ? post.langs.join(',') : '';
  const facets = post.facets ? JSON.stringify(post.facets) : '';
  const embedStr = post.embed ? JSON.stringify(post.embed) : '';
  xaddPost(did, String(post.text ?? ''), postUri, String(event.time_us ?? Date.now() * 1000), langs, facets, embedStr);

  // Bot mention detection
  const isMention = Array.isArray(post.facets) &&
    (post.facets as { features: { $type: string; did?: string }[] }[])
      .flatMap((f) => f.features)
      .some((f) => f.$type === 'app.bsky.richtext.facet#mention' && f.did === BOT_DID);

  if (isMention) {
    stats.mentions++;
    enqueueJob('botReply', {
      postUri,
      postCid: commit.cid ?? '',
      senderDid: did,
      text: (post.text as string) ?? '',
      interactionType: 'mention',
    });
    return;
  }

  // URL extraction — only for watched DIDs
  if (!watchedDids.has(did)) return;

  stats.posts++;
  const urls = extractUrlsFromPost(post as Parameters<typeof extractUrlsFromPost>[0]);
  for (const rawUrl of urls) {
    const url = normalizeArticleUrl(rawUrl);
    if (!url) continue;
    stats.urlsFound++;

    // LRU check — skip if we already enqueued this URL recently
    if (isRecentlySeen(url)) continue;

    stats.jobsQueued++;
    enqueueJob('fetchArticle', {
      url,
      sourceDid: did,
      postUri,
      postCid: commit.cid ?? '',
    });
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
    const lagMs = lastEventTimeUs
      ? Number(BigInt(Date.now()) * 1000n - lastEventTimeUs) / 1000
      : null;
    const lagDisplay = lagMs != null ? `${(lagMs / 1000).toFixed(1)}s` : 'n/a';

    logger.info(
      { ...stats, watchedDids: watchedDids.size, lruSize: recentUrls.size, cursor: currentCursor?.toString(), lagMs: lagMs != null ? Math.round(lagMs) : null, lag: lagDisplay },
      'Firehose heartbeat (last 30s)'
    );

    const timeSinceConnect = Date.now() - lastConnectTime;

    // Stale connection detection: if connected & had 0 events in the last interval, reconnect
    // regardless of readyState (as TCP can hang silently in OPEN or CONNECTING)
    if (stats.events === 0 && timeSinceConnect > 30_000) {
      logger.warn({ readyState: ws?.readyState, timeSinceConnect }, 'Firehose appears stale (0 events in >30s since connect), forcing reconnect');
      connect();
    } else if (ws?.readyState === 1 /* WebSocket.OPEN */) {
      ws.ping();
    }

    // Reset for next interval
    stats.events = 0;
    stats.posts = 0;
    stats.mentions = 0;
    stats.urlsFound = 0;
    stats.jobsQueued = 0;
    stats.lruHits = 0;
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

  // Start DM poller alongside firehose
  const { startDmPoller, stopDmPoller } = await import('../services/dmPoller.js');
  startDmPoller();

  // Graceful shutdown — stop DM poller too
  const shutdown = () => {
    stopDmPoller();
    if (ws) ws.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info({ cursor: currentCursor, dids: watchedDids.size }, 'Firehose consumer started');
}

start().catch((err) => {
  logger.error({ err }, 'Firehose startup failed');
  process.exit(1);
});

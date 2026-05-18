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
import { warmRecord, invalidateRecord } from '../lib/pdsCache.js';
import { refreshGeotaggedDids, geotagFromAccount, getGeoForDid } from '../nearby/geoCache.js';
import { getNearbyBotDid } from '../nearby/bot.js';

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
    // Clean up deleted likes/reposts/recommends from our interaction tracking
    if ((commit.collection === 'app.bsky.feed.like' || commit.collection === 'app.bsky.feed.repost' || commit.collection === 'site.standard.graph.recommend') && postUri) {
      db.query('DELETE FROM article_interactions WHERE record_uri = $1', [postUri])
        .catch(err => logger.debug({ err, postUri }, 'Failed to delete interaction record'));
    }
    // Clean up deleted longform documents from index
    const longformDeleteCollections = ['site.standard.document', 'pub.leaflet.document', 'com.whtwnd.blog.entry'];
    if (longformDeleteCollections.includes(commit.collection) && postUri) {
      db.query('DELETE FROM site_standard_articles WHERE uri = $1', [postUri])
        .catch(err => logger.debug({ err, postUri }, 'Failed to delete article from index'));
      invalidateRecord(did, commit.collection, commit.rkey || '').catch(() => {});
    }
    return;
  }

  // ── Like / Repost tracking on longform articles ────────────────────────────
  const interactionCollections = ['app.bsky.feed.like', 'app.bsky.feed.repost'];
  if (interactionCollections.includes(commit.collection) && commit.record) {
    const subject = commit.record.subject as { uri?: string } | undefined;
    if (subject?.uri && typeof subject.uri === 'string') {
      // Check if the subject is a longform document
      const longformPatterns = ['/site.standard.document/', '/pub.leaflet.document/'];
      if (longformPatterns.some(p => subject.uri!.includes(p))) {
        const interactionType = commit.collection === 'app.bsky.feed.like' ? 'like' : 'repost';
        db.query(
          `INSERT INTO article_interactions (article_uri, actor_did, interaction_type, record_uri)
           VALUES ($1, $2, $3, $4) ON CONFLICT (article_uri, actor_did, interaction_type) DO NOTHING`,
          [subject.uri, did, interactionType, postUri]
        ).catch(err => logger.debug({ err }, 'Failed to track article interaction'));
      }
    }
  }

  // ── Recommend tracking (Leaflet / standard.site "likes") ───────────────────
  if (commit.collection === 'site.standard.graph.recommend' && commit.record) {
    const articleUri = (commit.record.document || commit.record.subject) as string | undefined;
    if (articleUri && typeof articleUri === 'string') {
      const longformPatterns = ['/site.standard.document/', '/pub.leaflet.document/'];
      if (longformPatterns.some(p => articleUri.includes(p))) {
        db.query(
          `INSERT INTO article_interactions (article_uri, actor_did, interaction_type, record_uri)
           VALUES ($1, $2, 'like', $3) ON CONFLICT (article_uri, actor_did, interaction_type) DO NOTHING`,
          [articleUri, did, postUri]
        ).catch(err => logger.debug({ err }, 'Failed to track recommend interaction'));
      }
    }
  }

  // ── Follow-as-signup ──────────────────────────────────────────────────────
  if (commit.collection === 'app.bsky.graph.follow') {
    const subject = (commit.record?.subject as string | undefined);
    if (subject === BOT_DID) {
      enqueueJob('followSignup', { followerDid: did });
    }
    return;
  }

  // ── Long-form Document Ingestion (Leaflet, WhiteWind, etc) ────────────────
  const longformCollections = ['site.standard.document', 'com.whtwnd.blog.entry', 'pub.leaflet.document', 'site.standard.publication'];
  if (longformCollections.includes(commit.collection) && commit.record) {
    // For publication records, we just want to cache them if we don't have them
    if (commit.collection === 'site.standard.publication') {
      if (commit.record.url && typeof commit.record.url === 'string') {
        const pubUri = `at://${did}/site.standard.publication/${commit.rkey}`;
        db.query(
          'INSERT INTO site_publications (uri, url, raw_record) VALUES ($1, $2, $3) ON CONFLICT (uri) DO NOTHING',
          [pubUri, commit.record.url, commit.record]
        ).catch(err => logger.error({ err, uri: pubUri }, 'Failed to cache site.standard.publication'));
      }
      return;
    }

    // Warm the PDS record cache for fast page loads
    warmRecord(did, commit.collection, commit.rkey, commit.record).catch(() => {});

    // 1. Enqueue indexing job for this specific post (high priority for live events)
    enqueueJob('indexSiteStandard', {
      postUri,
      did,
      record: commit.record
    }, { priority: 10 });

    // 2. Check if we've seen this author before. If not, trigger a full backfill.
    // (We use a fire-and-forget catch to avoid blocking the firehose loop)
    isSiteStandardDidKnown(did).then(isKnown => {
      if (!isKnown) {
        markSiteStandardDidKnown(did).then(() => {
          logger.info({ did, collection: commit.collection }, 'Discovered new longform author, triggering backfill');
          enqueueJob('backfillSiteStandard', { did });
        });
      }
    }).catch(err => {
      logger.error({ err, did }, 'Failed to check known site standard DIDs');
    });

    // 3. Auto-geotag if the author is a geotagged account
    geotagFromAccount(postUri, 'document', did, getNearbyBotDid()).catch(() => {});

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

  // Auto-geotag posts from geotagged accounts (fire-and-forget)
  if (getGeoForDid(did)) {
    geotagFromAccount(postUri, 'post', did, getNearbyBotDid()).catch(() => {});
  }

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

  // ── Longform share detection — track posts that link to longform articles ──
  {
    const shareUrls: string[] = [];

    // Check facet links for longform URLs
    if (Array.isArray(post.facets)) {
      for (const facet of post.facets as any[]) {
        for (const feature of facet.features || []) {
          if (feature.$type === 'app.bsky.richtext.facet#link' && feature.uri) {
            shareUrls.push(feature.uri);
          }
        }
      }
    }

    // Check embed for longform URIs/URLs
    const embed = post.embed as any;
    if (embed) {
      if (embed.uri) shareUrls.push(embed.uri);
      if (embed.external?.uri) shareUrls.push(embed.external.uri);
    }

    for (const url of shareUrls) {
      // Match longform.social URLs → extract AT URI
      const longformMatch = url.match(/longform\.social\/post\/([^/]+)\/([^/?#]+)/);
      if (longformMatch) {
        const articleUri = `at://${longformMatch[1]}/site.standard.document/${longformMatch[2]}`;
        db.query(
          `INSERT INTO article_interactions (article_uri, actor_did, interaction_type, record_uri)
           VALUES ($1, $2, 'share', $3) ON CONFLICT (article_uri, actor_did, interaction_type) DO NOTHING`,
          [articleUri, did, postUri]
        ).catch(err => logger.debug({ err }, 'Failed to track longform share'));
        continue;
      }

      // Match leaflet.pub URLs → look up by rkey
      const leafletMatch = url.match(/([^.]+)\.leaflet\.pub\/([^/?#]+)/);
      if (leafletMatch) {
        // We don't know the DID from the subdomain, but we can match by rkey
        const rkey = leafletMatch[2];
        db.query(
          `INSERT INTO article_interactions (article_uri, actor_did, interaction_type, record_uri)
           SELECT uri, $1, 'share', $2 FROM site_standard_articles
           WHERE uri LIKE $3
           ON CONFLICT (article_uri, actor_did, interaction_type) DO NOTHING`,
          [did, postUri, `%/site.standard.document/${rkey}`]
        ).catch(err => logger.debug({ err }, 'Failed to track leaflet share'));
        continue;
      }

      // Match direct AT URIs pointing to longform docs
      if (url.startsWith('at://') && (/\/site\.standard\.document\//.test(url) || /\/pub\.leaflet\.document\//.test(url))) {
        db.query(
          `INSERT INTO article_interactions (article_uri, actor_did, interaction_type, record_uri)
           VALUES ($1, $2, 'share', $3) ON CONFLICT (article_uri, actor_did, interaction_type) DO NOTHING`,
          [url, did, postUri]
        ).catch(err => logger.debug({ err }, 'Failed to track AT URI share'));
      }
    }
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

  // Load geotagged DIDs into memory for nearby auto-tagging
  await refreshGeotaggedDids().catch(err => logger.warn({ err }, 'Failed initial geo cache load'));

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
    const lagDisplay = lagMs != null ? ((lagMs / 1000).toFixed(1) + 's') : 'n/a';

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

  logger.info({ cursor: currentCursor, dids: watchedDids.size }, "Firehose consumer started");
}

start().catch((err) => {
  logger.error({ err }, 'Firehose startup failed');
  process.exit(1);
});

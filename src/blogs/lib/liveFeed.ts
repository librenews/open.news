import { WebSocketServer, WebSocket } from 'ws';
import { pool } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { getCachedProfile } from '../../lib/pdsCache.js';
import type { Server } from 'http';
import type pg from 'pg';

const clients = new Set<WebSocket>();
let listenClient: pg.PoolClient | null = null;

// ── Batching ────────────────────────────────────────────────────────────────
// Instead of broadcasting per-insert, we accumulate a count and a small
// buffer of recent posts, then flush to all clients every FLUSH_INTERVAL ms.

const FLUSH_INTERVAL = 3000; // 3 seconds
const MAX_BATCH_POSTS = 5;   // only keep 5 newest per batch

let pendingCount = 0;
let pendingPosts: any[] = [];

function flushToClients() {
  if (pendingCount === 0 || clients.size === 0) return;

  const payload = JSON.stringify({
    type: 'batch',
    count: pendingCount,
    posts: pendingPosts.slice(-MAX_BATCH_POSTS),
  });

  pendingCount = 0;
  pendingPosts = [];

  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(payload); } catch {}
    }
  }
}

/**
 * Start a dedicated PG connection for LISTEN/NOTIFY.
 * Accumulates notifications and flushes on an interval.
 */
async function startListener() {
  try {
    listenClient = await pool.connect();
    await listenClient.query('LISTEN new_article');
    logger.info('Blogs live feed: LISTEN new_article started');

    listenClient.on('notification', async (msg) => {
      if (msg.channel !== 'new_article' || !msg.payload) return;

      try {
        const data = JSON.parse(msg.payload);
        pendingCount++;

        // Only build full post data for the buffer if we have room
        if (pendingPosts.length < MAX_BATCH_POSTS) {
          // Resolve profile
          let profile = { handle: data.author_did, avatar: '', displayName: '' };
          try {
            const p = await getCachedProfile(data.author_did);
            profile = {
              handle: p.handle || data.author_did,
              avatar: p.avatar || '',
              displayName: p.displayName || '',
            };
          } catch {}

          // Fetch record
          const { rows } = await pool.query(`
            SELECT
              s.uri, s.author_did, s.title, s.site, s.path,
              s.published_at, s.word_count, s.created_at,
              COALESCE(s.description, LEFT(s.raw_record->>'textContent', 400)) AS text_content,
              s.raw_record->'tags' AS tags_json
            FROM site_standard_articles s
            WHERE s.uri = $1
          `, [data.uri]);

          if (rows.length > 0) {
            const r = rows[0];
            const uriParts = r.uri.replace('at://', '').split('/');
            const rkey = uriParts[uriParts.length - 1];

            let tags: string[] = [];
            try {
              if (r.tags_json && Array.isArray(r.tags_json)) tags = r.tags_json;
            } catch {}

            pendingPosts.push({
              uri: r.uri,
              rkey,
              author_did: r.author_did,
              author_handle: profile.handle,
              author_display_name: profile.displayName,
              author_avatar: profile.avatar || null,
              title: r.title,
              text_content: r.text_content,
              site: r.site,
              path: r.path,
              tags: tags.slice(0, 3),
              published_at: r.created_at?.toISOString() || r.published_at?.toISOString() || new Date().toISOString(),
              word_count: Number(r.word_count || 0),
            });
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Blogs live feed: failed to process notification');
      }
    });

    listenClient.on('error', (err) => {
      logger.error({ err }, 'Blogs live feed: PG listen connection error');
      listenClient = null;
      setTimeout(startListener, 5000);
    });

  } catch (err) {
    logger.error({ err }, 'Blogs live feed: failed to start listener');
    setTimeout(startListener, 5000);
  }
}

/**
 * Attach WebSocket upgrade handler to the HTTP server.
 */
export function attachLiveFeed(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (request.url === '/ws/feed') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        clients.add(ws);

        ws.on('close', () => {
          clients.delete(ws);
        });

        ws.on('error', () => {
          clients.delete(ws);
        });

        ws.send(JSON.stringify({ type: 'connected' }));
      });
    } else {
      socket.destroy();
    }
  });

  // Flush batched notifications every 3 seconds
  setInterval(flushToClients, FLUSH_INTERVAL);

  // Start the PG LISTEN
  startListener();

  logger.info('Blogs live feed WebSocket attached');
}

import { WebSocketServer, WebSocket } from 'ws';
import { pool } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { getCachedProfile } from '../../lib/pdsCache.js';
import type { Server } from 'http';
import type pg from 'pg';

const clients = new Set<WebSocket>();
let listenClient: pg.PoolClient | null = null;

/**
 * Start a dedicated PG connection for LISTEN/NOTIFY
 * and broadcast new articles to all connected WebSocket clients.
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

        // Resolve profile for the author
        let profile = { handle: data.author_did, avatar: '', displayName: '' };
        try {
          const p = await getCachedProfile(data.author_did);
          profile = {
            handle: p.handle || data.author_did,
            avatar: p.avatar || '',
            displayName: p.displayName || '',
          };
        } catch {}

        // Fetch full record for the card
        const { rows } = await pool.query(`
          SELECT
            s.uri, s.author_did, s.title, s.site, s.path,
            s.published_at, s.word_count, s.created_at,
            LEFT(s.raw_record->>'textContent', 2000) AS text_content,
            s.raw_record->'tags' AS tags_json
          FROM site_standard_articles s
          WHERE s.uri = $1
        `, [data.uri]);

        if (rows.length === 0) return;

        const r = rows[0];
        const uriParts = r.uri.replace('at://', '').split('/');
        const rkey = uriParts[uriParts.length - 1];

        let tags: string[] = [];
        try {
          if (r.tags_json && Array.isArray(r.tags_json)) tags = r.tags_json;
        } catch {}

        const payload = JSON.stringify({
          type: 'new_post',
          post: {
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
          }
        });

        // Broadcast to all connected clients
        for (const ws of clients) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Blogs live feed: failed to process notification');
      }
    });

    // Reconnect on error
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
        logger.info({ clients: clients.size }, 'Blogs WS client connected');

        ws.on('close', () => {
          clients.delete(ws);
        });

        ws.on('error', () => {
          clients.delete(ws);
        });

        // Send a welcome message
        ws.send(JSON.stringify({ type: 'connected', clients: clients.size }));
      });
    } else {
      socket.destroy();
    }
  });

  // Start the PG LISTEN
  startListener();

  logger.info('Blogs live feed WebSocket attached');
}

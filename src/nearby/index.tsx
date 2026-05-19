import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { NearbyLayout } from './views/layout.js';
import { LandingPage } from './views/landing.js';
import { CityFeedPage } from './views/feed.js';
import { getCachedProfile } from '../lib/pdsCache.js';

const app = new Hono();

// ── Health ─────────────────────────────────────────────────────────────────
app.get('/health', async (c) => {
  try {
    await db.query('SELECT 1');
    return c.json({ status: 'ok', service: 'nearby' });
  } catch {
    return c.json({ status: 'error' }, 503);
  }
});

// ── Landing page ───────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const { rows: cities } = await db.query(`
    SELECT 
      p.place_id, p.name, p.place_type,
      parent.name AS parent_name,
      COUNT(*) FILTER (WHERE g.subject_type IN ('document', 'post')) AS article_count,
      COUNT(*) FILTER (WHERE g.subject_type = 'account') AS account_count
    FROM nearby_geotags g
    JOIN nearby_places p ON p.place_id = g.place_id
    LEFT JOIN nearby_places parent ON parent.place_id = p.parent_place_id
    WHERE p.place_type = 'city'
    GROUP BY p.place_id, p.name, p.place_type, parent.name
    HAVING COUNT(*) FILTER (WHERE g.subject_type IN ('document', 'post')) > 0
    ORDER BY COUNT(*) FILTER (WHERE g.subject_type IN ('document', 'post')) DESC
  `);

  return c.html((
    <NearbyLayout title="nearby.at — Local news from the open social web">
      <LandingPage cities={cities.map((r: any) => ({
        place_id: r.place_id,
        name: r.name,
        place_type: r.place_type,
        parent_name: r.parent_name,
        article_count: Number(r.article_count),
        account_count: Number(r.account_count),
      }))} />
    </NearbyLayout>
  ) as unknown as string);
});

// ── City feed ──────────────────────────────────────────────────────────────
app.get('/city/:placeId', async (c) => {
  const placeId = c.req.param('placeId');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const perPage = 30;
  const offset = (page - 1) * perPage;

  // Validate place exists
  const { rows: placeRows } = await db.query(
    `SELECT p.place_id, p.name, parent.name AS parent_name
     FROM nearby_places p
     LEFT JOIN nearby_places parent ON parent.place_id = p.parent_place_id
     WHERE p.place_id = $1`,
    [placeId]
  );
  if (placeRows.length === 0) return c.text('City not found', 404);
  const place = placeRows[0];

  // City stats
  const { rows: [stats] } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE subject_type = 'document') AS article_count,
      COUNT(*) FILTER (WHERE subject_type = 'post') AS post_count,
      COUNT(*) FILTER (WHERE subject_type = 'account') AS account_count
    FROM nearby_geotags WHERE place_id = $1
  `, [placeId]);

  // Feed items: documents + posts combined
  const { rows: feedRows } = await db.query(`
    (
      SELECT
        g.subject AS uri, 'document' AS subject_type, g.confidence,
        s.title, s.description, NULL AS post_text,
        s.site,
        COALESCE(s.author_did, split_part(replace(g.subject, 'at://', ''), '/', 1)) AS author_did,
        COALESCE(s.published_at, g.created_at) AS sort_date
      FROM nearby_geotags g
      LEFT JOIN site_standard_articles s ON s.uri = g.subject
      WHERE g.place_id = $1 AND g.subject_type = 'document'
    )
    UNION ALL
    (
      SELECT
        g.subject AS uri, 'post' AS subject_type, g.confidence,
        NULL AS title, NULL AS description,
        COALESCE(m.post_text, pc.post_text) AS post_text,
        NULL AS site,
        COALESCE(m.post_did, pc.post_did, split_part(replace(g.subject, 'at://', ''), '/', 1)) AS author_did,
        COALESCE(m.matched_at, g.created_at) AS sort_date
      FROM nearby_geotags g
      LEFT JOIN track_matches m ON m.post_uri = g.subject
      LEFT JOIN nearby_post_cache pc ON pc.post_uri = g.subject
      WHERE g.place_id = $1 AND g.subject_type = 'post'
    )
    ORDER BY sort_date DESC
    LIMIT $2 OFFSET $3
  `, [placeId, perPage, offset]);

  // Resolve author profiles (batch, cached)
  const uniqueDids = [...new Set(feedRows.map((r: any) => r.author_did).filter(Boolean))];
  const profileMap: Record<string, { handle: string; avatar: string; displayName: string }> = {};
  await Promise.all(uniqueDids.slice(0, 20).map(async (did) => {
    try {
      const p = await getCachedProfile(did as string);
      profileMap[did as string] = { handle: p.handle || did as string, avatar: p.avatar || '', displayName: p.displayName || '' };
    } catch {
      profileMap[did as string] = { handle: did as string, avatar: '', displayName: '' };
    }
  }));

  const feedItems = feedRows.map((r: any) => ({
    uri: r.uri,
    subject_type: r.subject_type as 'document' | 'post',
    title: r.title,
    description: r.description,
    text: r.post_text,
    site: r.site,
    author_did: r.author_did || '',
    author_handle: profileMap[r.author_did]?.handle || r.author_did || 'unknown',
    author_avatar: profileMap[r.author_did]?.avatar || null,
    published_at: r.sort_date?.toISOString() || new Date().toISOString(),
    confidence: Number(r.confidence),
  }));

  // Sidebar: all cities with content
  const { rows: sidebarCities } = await db.query(`
    SELECT p.place_id, p.name, COUNT(*) AS count
    FROM nearby_geotags g
    JOIN nearby_places p ON p.place_id = g.place_id
    WHERE p.place_type = 'city' AND g.subject_type IN ('document', 'post')
    GROUP BY p.place_id, p.name
    ORDER BY count DESC
  `);

  // Local accounts
  const { rows: accountRows } = await db.query(`
    SELECT g.subject AS did, g.confidence
    FROM nearby_geotags g
    WHERE g.place_id = $1 AND g.subject_type = 'account'
    ORDER BY g.confidence DESC
    LIMIT 10
  `, [placeId]);

  const localAccounts = await Promise.all(accountRows.map(async (r: any) => {
    try {
      const p = await getCachedProfile(r.did);
      // Count posts from this account in this city
      const { rows: [cnt] } = await db.query(
        `SELECT COUNT(*) AS c FROM nearby_geotags WHERE subject_type IN ('post', 'document') AND place_id = $1
         AND subject IN (SELECT uri FROM site_standard_articles WHERE author_did = $2)`,
        [placeId, r.did]
      );
      return {
        did: r.did,
        handle: p.handle || r.did,
        avatar: p.avatar || null,
        display_name: p.displayName || p.handle || r.did,
        post_count: Number(cnt?.c || 0),
      };
    } catch {
      return { did: r.did, handle: r.did, avatar: null, display_name: r.did, post_count: 0 };
    }
  }));

  return c.html((
    <NearbyLayout title={`${place.name} — nearby.at`} currentPlaceId={placeId}>
      <CityFeedPage
        city={{
          place_id: placeId,
          name: place.name,
          parent_name: place.parent_name,
          article_count: Number(stats.article_count),
          post_count: Number(stats.post_count),
          account_count: Number(stats.account_count),
        }}
        items={feedItems}
        cities={sidebarCities.map((r: any) => ({ place_id: r.place_id, name: r.name, count: Number(r.count) }))}
        accounts={localAccounts}
        page={page}
      />
    </NearbyLayout>
  ) as unknown as string);
});

// ── Error handling ─────────────────────────────────────────────────────────
app.onError((err, c) => {
  logger.error({ err, path: c.req.path }, 'Nearby request error');
  return c.html(`<html><body style="background:#0f1115;color:white;font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh">
    <div style="text-align:center"><h1 style="font-size:4rem;opacity:0.2">500</h1><p style="opacity:0.5">Something went wrong</p><a href="/" style="color:#3b82f6">← Back</a></div>
  </body></html>`, 500);
});

app.notFound((c) => {
  return c.html(`<html><body style="background:#0f1115;color:white;font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh">
    <div style="text-align:center"><h1 style="font-size:4rem;opacity:0.2">404</h1><p style="opacity:0.5">Not found</p><a href="/" style="color:#3b82f6">← Back</a></div>
  </body></html>`, 404);
});

// ── Start ──────────────────────────────────────────────────────────────────
const NEARBY_PORT = Number(process.env.NEARBY_PORT) || 4700;

async function start() {
  await runMigrations();
  
  serve({ fetch: app.fetch, port: NEARBY_PORT }, () => {
    logger.info({ port: NEARBY_PORT, domain: config.NEARBY_DOMAIN }, 'nearby.at server started');
  });
}

start().catch((err) => {
  logger.error({ err }, 'nearby.at startup failed');
  process.exit(1);
});

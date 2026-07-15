import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { html } from 'hono/html';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { getCachedProfile, getCachedProfiles } from '../lib/pdsCache.js';
import { searchMediaContent, getRelatedVideos } from '../track/opensearch.js';
import { SnipLayout, type SnipProfile } from './views/layout.js';
import { FeedPage, type VideoItem } from './views/feed.js';
import { AuthorPage, type AuthorProfile } from './views/author.js';
import { LeaderboardPage, type CreatorRow } from './views/leaderboard.js';
import { CommentsPage } from './views/comments.js';
import { EmbedPage } from './views/embed.js';
import { AtpAgent } from '@atproto/api';
import { snipAuthRouter, getSessionUser } from './auth.js';
import { CATEGORIES } from './categories.js';

const app = new Hono();
const SNIP_PORT = parseInt(process.env.SNIP_PORT ?? '5100', 10);
const SNIP_BASE = process.env.SNIP_BASE_URL ?? 'https://snip.social';

// ── In-Memory Cache ─────────────────────────────────────────────────────────
const cache = new Map<string, { data: any; expiresAt: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: any, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

const CACHE_TTL = {
  trending:    15 * 60 * 1000,  // 15 minutes
  feed:         2 * 60 * 1000,  // 2 minutes
  leaderboard:  5 * 60 * 1000,  // 5 minutes
};

app.route('/', snipAuthRouter);

// Helper: Escape XML
function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Helper: Build enriched media records
async function enrichMediaItems(rows: any[]): Promise<VideoItem[]> {
  if (rows.length === 0) return [];
  const uniqueDids = [...new Set(rows.map((r: any) => r.did))];
  const profileMap = await getCachedProfiles(uniqueDids);

  return rows.map((r: any) => {
    const profile = profileMap.get(r.did) || { handle: r.did, displayName: r.did, avatar: '' };
    return {
      id: r.id,
      uri: r.uri,
      did: r.did,
      rkey: r.rkey,
      cid: r.cid || null,
      thumbnail_cid: r.thumbnail_cid || null,
      source_url: r.source_url,
      alt_text: r.alt_text,
      aspect_ratio: r.aspect_ratio,
      post_text: r.post_text,
      transcript: r.transcript,
      language: r.language,
      duration_ms: r.duration_ms,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      author_handle: profile.handle,
      author_display_name: profile.displayName || profile.handle,
      author_avatar: profile.avatar || null,
      like_count: Number(r.like_count || 0),
      repost_count: Number(r.repost_count || 0),
    };
  });
}

// Helper: Fetch trending video terms (cached 15 min)
async function getTrendingTerms(limit = 8): Promise<string[]> {
  const cacheKey = `trending:${limit}`;
  const cached = getCached<string[]>(cacheKey);
  if (cached) return cached;

  try {
    const { rows } = await db.query<{ word: string }>(`
      SELECT word, count(*) as cnt
      FROM (
        SELECT regexp_replace(regexp_split_to_table(lower(text), '\\s+'), '[^a-z]', '', 'g') as word
        FROM media_transcripts
        WHERE created_at > NOW() - INTERVAL '48 hours'
          AND language = 'en'
      ) words
      WHERE length(word) > 5
        AND word NOT IN (
          -- Articles, pronouns, prepositions, conjunctions
          'about', 'above', 'across', 'after', 'again', 'against', 'along', 'already',
          'among', 'another', 'around', 'became', 'because', 'become', 'before', 'behind',
          'being', 'below', 'besides', 'between', 'beyond', 'brought', 'called',
          -- Common verbs and verb forms
          'could', 'didnt', 'doesnt', 'doing', 'during', 'either', 'enough',
          'every', 'everything', 'everyone', 'getting', 'giving', 'going', 'gotten',
          'having', 'havent', 'however', 'inside', 'itself', 'keeping',
          -- Filler words and speech patterns
          'actually', 'already', 'always', 'basically', 'clearly', 'definitely',
          'especially', 'exactly', 'honestly', 'literally', 'maybe', 'mostly',
          'obviously', 'perhaps', 'pretty', 'probably', 'really', 'simply',
          'sometimes', 'somewhat', 'specifically', 'totally', 'usually',
          -- Common nouns and adjectives too generic to be useful
          'better', 'coming', 'different', 'first', 'great', 'house', 'know',
          'little', 'looking', 'making', 'might', 'never', 'nothing', 'other',
          'people', 'person', 'place', 'right', 'saying', 'should', 'since',
          'small', 'something', 'still', 'stuff', 'talking', 'telling',
          'thats', 'their', 'them', 'theres', 'these', 'theyre', 'thing',
          'things', 'think', 'those', 'thought', 'through', 'today', 'trying',
          'under', 'until', 'using', 'wants', 'watch', 'where', 'whether',
          'which', 'while', 'whole', 'without', 'world', 'would', 'years',
          'youre', 'youve',
          -- Common non-English words that appear in mixed transcripts
          'porque', 'puede', 'tiene', 'donde', 'como', 'estar', 'hacer',
          'aussi', 'cette', 'comme', 'dans', 'mais', 'pour', 'avec'
        )
      GROUP BY word
      ORDER BY cnt DESC
      LIMIT $1
    `, [limit]);
    const result = rows.map(r => r.word);
    setCache(cacheKey, result, CACHE_TTL.trending);
    return result;
  } catch (err) {
    logger.error({ err }, 'Failed to fetch trending video terms');
    return [];
  }
}

// ── Video Stream Proxy (Supports Range Requests & iOS/Safari) ─────────────────
app.get('/video/proxy/:did/:cid', async (c) => {
  const did = c.req.param('did');
  const cid = c.req.param('cid');
  const targetUrl = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
  
  const requestHeaders: Record<string, string> = {};
  const range = c.req.header('range');
  if (range) {
    requestHeaders['Range'] = range;
  }
  
  try {
    const res = await fetch(targetUrl, { headers: requestHeaders });
    
    // Set response status
    c.status(res.status as any);
    
    // Set headers
    c.header('Content-Type', 'video/mp4');
    c.header('Accept-Ranges', 'bytes');
    c.header('Cache-Control', 'public, max-age=86400');
    
    const contentLength = res.headers.get('content-length');
    if (contentLength) c.header('Content-Length', contentLength);
    
    const contentRange = res.headers.get('content-range');
    if (contentRange) c.header('Content-Range', contentRange);
    
    return c.body(res.body);
  } catch (err) {
    logger.error({ err, did, cid }, 'Video proxy streaming failed');
    return c.text('Proxy error', 500);
  }
});

// ── oEmbed Discovery Tag Builder ─────────────────────────────────────────────
function oembedDiscoveryTag(pageUrl: string, title: string): string {
  const encodedUrl = encodeURIComponent(pageUrl);
  const escapedTitle = title.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<link rel="alternate" type="application/json+oembed" href="${SNIP_BASE}/oembed?url=${encodedUrl}&format=json" title="${escapedTitle}" />`;
}

// ── oEmbed Provider Endpoint ─────────────────────────────────────────────────
app.get('/oembed', async (c) => {
  const url = c.req.query('url');
  const format = c.req.query('format') || 'json';
  const maxwidth = parseInt(c.req.query('maxwidth') || '480', 10);
  const maxheight = parseInt(c.req.query('maxheight') || '360', 10);

  if (format !== 'json') {
    return c.text('Only JSON format is supported', 501);
  }
  if (!url) {
    return c.text('Missing required "url" parameter', 400);
  }

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const params = parsed.searchParams;

    let title = 'Snip Videos';
    let embedUrl = `${SNIP_BASE}/embed`;
    let thumbnailUrl: string | null = null;

    if (pathname.startsWith('/post/')) {
      // Single post embed
      const postUri = decodeURIComponent(pathname.replace('/post/', ''));
      embedUrl = `${SNIP_BASE}/embed?uri=${encodeURIComponent(postUri)}`;

      // Look up the post for metadata
      const { rows } = await db.query(`
        SELECT mi.*, mt.text as transcript
        FROM media_items mi
        LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
        WHERE mi.uri = $1 AND mi.status = 'done' AND mi.error IS NULL
        LIMIT 1
      `, [postUri]);
      if (rows.length > 0) {
        const item = rows[0];
        const enriched = await enrichMediaItems([item]);
        title = enriched[0].post_text || enriched[0].alt_text || 'Video on Snip';
        if (item.thumbnail_cid && item.did) {
          thumbnailUrl = item.thumbnail_cid.startsWith('http')
            ? item.thumbnail_cid
            : `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(item.did)}&cid=${encodeURIComponent(item.thumbnail_cid)}`;
        }
      } else {
        return c.json({ error: 'Post not found' }, 404);
      }
    } else {
      // Feed / search / category embed
      const q = params.get('q') || '';
      const type = params.get('type') || 'top';
      const category = params.get('category') || '';

      const embedParams = new URLSearchParams();
      if (q) {
        embedParams.set('q', q);
        title = `Snip — Videos matching "${q}"`;
      } else if (category) {
        embedParams.set('category', category);
        title = `Snip — ${category} Videos`;
      } else {
        embedParams.set('type', type);
        title = type === 'latest' ? 'Snip — Latest Videos' : 'Snip — Top Videos';
      }
      embedUrl = `${SNIP_BASE}/embed?${embedParams.toString()}`;

      // Grab first result's thumbnail for the oEmbed thumbnail
      try {
        let firstRow: any = null;
        if (q) {
          const hits = await searchMediaContent(q, 1);
          if (hits.length > 0) {
            const { rows } = await db.query(`
              SELECT mi.* FROM media_items mi WHERE mi.uri = $1 AND mi.status = 'done' LIMIT 1
            `, [hits[0]._source.uri]);
            firstRow = rows[0];
          }
        } else {
          const { rows } = await db.query(`
            SELECT mi.* FROM media_items mi
            LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
            WHERE mi.status = 'done' AND mi.error IS NULL AND mt.language = 'en'
            ORDER BY mi.created_at DESC LIMIT 1
          `);
          firstRow = rows[0];
        }
        if (firstRow?.thumbnail_cid && firstRow?.did) {
          thumbnailUrl = firstRow.thumbnail_cid.startsWith('http')
            ? firstRow.thumbnail_cid
            : `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(firstRow.did)}&cid=${encodeURIComponent(firstRow.thumbnail_cid)}`;
        }
      } catch (thumbErr) {
        logger.debug({ err: thumbErr }, 'Failed to fetch oEmbed thumbnail (non-fatal)');
      }
    }

    // Clamp dimensions
    const width = Math.min(maxwidth, 480);
    const height = Math.min(maxheight, 360);

    const response: Record<string, any> = {
      version: '1.0',
      type: 'video',
      provider_name: 'Snip',
      provider_url: SNIP_BASE,
      title,
      width,
      height,
      html: `<iframe src="${embedUrl}" width="${width}" height="${height}" frameborder="0" allowfullscreen allow="autoplay; encrypted-media"></iframe>`,
    };

    if (thumbnailUrl) {
      response.thumbnail_url = thumbnailUrl;
      response.thumbnail_width = 480;
      response.thumbnail_height = 270;
    }

    c.header('Content-Type', 'application/json');
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(response);
  } catch (err) {
    logger.error({ err, url }, 'oEmbed endpoint error');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// ── Embed Player (rendered inside iframe) ────────────────────────────────────
app.get('/embed', async (c) => {
  const q = c.req.query('q') || '';
  const type = c.req.query('type') || 'top';
  const category = c.req.query('category') || '';
  const uri = c.req.query('uri') || '';
  const EMBED_LIMIT = 10;

  let items: VideoItem[] = [];
  let title = 'Snip Videos';

  try {
    if (uri) {
      // Single post embed
      const { rows } = await db.query(`
        SELECT mi.*, mt.text as transcript, mt.language,
               COALESCE(ic.like_count, 0) as like_count,
               COALESCE(ic.repost_count, 0) as repost_count
        FROM media_items mi
        LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
        LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
        WHERE mi.uri = $1 AND mi.status = 'done' AND mi.error IS NULL
        LIMIT 1
      `, [uri]);
      items = await enrichMediaItems(rows);
      if (items.length > 0) {
        title = items[0].post_text || items[0].alt_text || 'Video on Snip';
      }
    } else if (q) {
      // Search embed
      title = `Snip — "${q}"`;
      const hits = await searchMediaContent(q, EMBED_LIMIT);
      const postUris = hits.map((h: any) => h._source.uri);
      if (postUris.length > 0) {
        const { rows } = await db.query(`
          SELECT mi.*, mt.text as transcript, mt.language,
                 COALESCE(ic.like_count, 0) as like_count,
                 COALESCE(ic.repost_count, 0) as repost_count
          FROM media_items mi
          LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
          LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
          WHERE mi.uri = ANY($1) AND mi.status = 'done' AND mi.error IS NULL AND mt.language = 'en'
        `, [postUris]);
        items = await enrichMediaItems(rows);
      }
    } else if (category) {
      // Category embed
      title = `Snip — ${category}`;
      const { rows } = await db.query(`
        SELECT mi.*, mt.text as transcript, mt.language,
               COALESCE(ic.like_count, 0) as like_count,
               COALESCE(ic.repost_count, 0) as repost_count,
               (COALESCE(ic.like_count, 0) + COALESCE(ic.repost_count, 0) * 2.0 + 1.0) / 
                 POWER((EXTRACT(EPOCH FROM (NOW() - mi.created_at))/3600.0) + 2.0, 1.8) as score
        FROM media_items mi
        LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
        LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
        WHERE mi.status = 'done' AND mi.error IS NULL
          AND mt.language = 'en'
          AND (mt.category = $1 OR mt.secondary_category = $1)
        ORDER BY score DESC, mi.created_at DESC
        LIMIT $2
      `, [category, EMBED_LIMIT]);
      items = await enrichMediaItems(rows);
    } else {
      // Top / Latest feed embed
      title = type === 'latest' ? 'Snip — Latest Videos' : 'Snip — Top Videos';
      let queryStr = '';
      if (type === 'latest') {
        queryStr = `
          SELECT mi.*, mt.text as transcript, mt.language,
                 COALESCE(ic.like_count, 0) as like_count,
                 COALESCE(ic.repost_count, 0) as repost_count
          FROM media_items mi
          LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
          LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
          WHERE mi.status = 'done' AND mi.error IS NULL AND mt.language = 'en'
          ORDER BY mi.created_at DESC
          LIMIT ${EMBED_LIMIT}
        `;
      } else {
        queryStr = `
          SELECT mi.*, mt.text as transcript, mt.language,
                 COALESCE(ic.like_count, 0) as like_count,
                 COALESCE(ic.repost_count, 0) as repost_count,
                 (COALESCE(ic.like_count, 0) + COALESCE(ic.repost_count, 0) * 2.0 + 1.0) / 
                   POWER((EXTRACT(EPOCH FROM (NOW() - mi.created_at))/3600.0) + 2.0, 1.8) as score
          FROM media_items mi
          LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
          LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
          WHERE mi.status = 'done' AND mi.error IS NULL AND mt.language = 'en'
          ORDER BY score DESC, mi.created_at DESC
          LIMIT ${EMBED_LIMIT}
        `;
      }
      const { rows } = await db.query(queryStr);
      items = await enrichMediaItems(rows);
    }
  } catch (err) {
    logger.error({ err }, 'Embed page error');
  }

  // Allow this page to be embedded in iframes
  c.header('X-Frame-Options', 'ALLOWALL');
  c.header('Content-Security-Policy', "frame-ancestors *");

  return c.html(EmbedPage({ items, title }));
});

// ── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', async (c) => {
  return c.json({ status: 'ok', service: 'snip' });
});

// ── Homepage (Top / Latest Feed) ──────────────────────────────────────────────
app.get('/', async (c) => {
  const q = c.req.query('q') || '';
  const type = c.req.query('type') || 'top'; // top or latest
  const category = c.req.query('category') || '';

  const trending = await getTrendingTerms(8);

  let items: VideoItem[] = [];

  try {
    if (q) {
      // Search mode using OpenSearch
      const hits = await searchMediaContent(q, 30);
      const postUris = hits.map((h: any) => h._source.uri);

      if (postUris.length > 0) {
        const { rows } = await db.query(`
          SELECT mi.*, mt.text as transcript, mt.language,
                 COALESCE(ic.like_count, 0) as like_count,
                 COALESCE(ic.repost_count, 0) as repost_count
          FROM media_items mi
          LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
          LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
          WHERE mi.uri = ANY($1) AND mi.status = 'done' AND mi.error IS NULL AND mt.language = 'en'
        `, [postUris]);
        items = await enrichMediaItems(rows);
      }
    } else if (category) {
      // Category mode — filter by LLM-assigned transcript category
      const cacheKey = `feed:category:${category}`;
      const cachedItems = getCached<VideoItem[]>(cacheKey);
      if (cachedItems) {
        items = cachedItems;
      } else {
        const { rows } = await db.query(`
          SELECT mi.*, mt.text as transcript, mt.language,
                 COALESCE(ic.like_count, 0) as like_count,
                 COALESCE(ic.repost_count, 0) as repost_count,
                 (COALESCE(ic.like_count, 0) + COALESCE(ic.repost_count, 0) * 2.0 + 1.0) / 
                   POWER((EXTRACT(EPOCH FROM (NOW() - mi.created_at))/3600.0) + 2.0, 1.8) as score
          FROM media_items mi
          LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
          LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
          WHERE mi.status = 'done' AND mi.error IS NULL
            AND mt.language = 'en'
            AND (mt.category = $1 OR mt.secondary_category = $1)
          ORDER BY score DESC, mi.created_at DESC
          LIMIT 25
        `, [category]);
        items = await enrichMediaItems(rows);
        setCache(cacheKey, items, CACHE_TTL.feed);
      }
    } else {
      // Browsing mode (Top / Latest)
      const cacheKey = `feed:${type}`;
      const cachedItems = getCached<VideoItem[]>(cacheKey);
      if (cachedItems) {
        items = cachedItems;
      } else {
        let queryStr = '';
        if (type === 'latest') {
          queryStr = `
            SELECT mi.*, mt.text as transcript, mt.language,
                   COALESCE(ic.like_count, 0) as like_count,
                   COALESCE(ic.repost_count, 0) as repost_count
            FROM media_items mi
            LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
            LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
            WHERE mi.status = 'done' AND mi.error IS NULL AND mt.language = 'en'
            ORDER BY mi.created_at DESC
            LIMIT 25
          `;
        } else {
          // Hacker News algorithm (Likes + Reposts*2 + 1) / (Age + 2)^1.8
          queryStr = `
            SELECT mi.*, mt.text as transcript, mt.language,
                   COALESCE(ic.like_count, 0) as like_count,
                   COALESCE(ic.repost_count, 0) as repost_count,
                   (COALESCE(ic.like_count, 0) + COALESCE(ic.repost_count, 0) * 2.0 + 1.0) / 
                     POWER((EXTRACT(EPOCH FROM (NOW() - mi.created_at))/3600.0) + 2.0, 1.8) as score
            FROM media_items mi
            LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
            LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
            WHERE mi.status = 'done' AND mi.error IS NULL AND mt.language = 'en'
            ORDER BY score DESC, mi.created_at DESC
            LIMIT 25
          `;
        }
        const { rows } = await db.query(queryStr);
        items = await enrichMediaItems(rows);
        setCache(cacheKey, items, CACHE_TTL.feed);
      }
    }
  } catch (err) {
    logger.error({ err }, 'Failed to fetch homepage items');
  }

  // Resolve category display name for the active header
  const categoryInfo = CATEGORIES.find(c => c.slug === category);
  const categoryName = categoryInfo?.name || category;

  // Build oEmbed discovery tag for this page
  const pageParams = new URLSearchParams();
  if (q) pageParams.set('q', q);
  else if (category) pageParams.set('category', category);
  else pageParams.set('type', type);
  const pageUrl = `${SNIP_BASE}/?${pageParams.toString()}`;
  const oembedTitle = q ? `Snip — Videos matching "${q}"` : category ? `Snip — ${category} Videos` : 'Snip — High Signal ATProto Videos';
  const headExtra = html`${oembedDiscoveryTag(pageUrl, oembedTitle)}`;

  const session = await getSessionUser(c);
  const pageHtml = FeedPage({ items, type, q, category: category, trending });
  return c.html(SnipLayout({ title: 'Snip — High Signal ATProto Videos', children: pageHtml, q, type, session, headExtra }));
});

// ── Leaderboard (Top Creators) ────────────────────────────────────────────────
app.get('/leaderboard', async (c) => {
  let creators: CreatorRow[] = [];
  try {
    const cacheKey = 'leaderboard';
    const cachedCreators = getCached<CreatorRow[]>(cacheKey);
    if (cachedCreators) {
      creators = cachedCreators;
    } else {
    const { rows } = await db.query(`
      SELECT mi.did,
             count(*) as video_count,
             COALESCE(sum(ic.like_count), 0) as total_likes,
             COALESCE(sum(ic.repost_count), 0) as total_reposts
      FROM media_items mi
      LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
      WHERE mi.status = 'done' AND mi.error IS NULL
      GROUP BY mi.did
      ORDER BY total_likes DESC, video_count DESC
      LIMIT 25
    `);

    const uniqueDids = rows.map((r: any) => r.did);
    const profileMap = await getCachedProfiles(uniqueDids);

    creators = rows.map((r: any) => {
      const p = profileMap.get(r.did) || { handle: r.did, displayName: r.did, avatar: '' };
      return {
        did: r.did,
        handle: p.handle,
        displayName: p.displayName || p.handle,
        avatar: p.avatar || null,
        video_count: Number(r.video_count),
        total_likes: Number(r.total_likes),
        total_reposts: Number(r.total_reposts),
      };
    });
    setCache(cacheKey, creators, CACHE_TTL.leaderboard);
    } // end of else (cache miss)
  } catch (err) {
    logger.error({ err }, 'Failed to load leaderboard');
  }

  const session = await getSessionUser(c);
  const pageHtml = LeaderboardPage({ creators });
  return c.html(SnipLayout({ title: 'Top Video Creators — Snip', children: pageHtml, activeTab: 'leaderboard', session }));
});

// ── Author Profile Page ───────────────────────────────────────────────────────
app.get('/profile/:did', async (c) => {
  const did = c.req.param('did');
  let profile: AuthorProfile = { did, handle: did, displayName: null, description: null, avatar: null, banner: null };
  let items: VideoItem[] = [];
  let stats = { video_count: 0, total_likes: 0, total_reposts: 0 };

  try {
    const p = await getCachedProfile(did);
    profile = {
      did,
      handle: p.handle || did,
      displayName: p.displayName || null,
      description: p.description || null,
      avatar: p.avatar || null,
      banner: p.banner || null,
      followersCount: p.followersCount,
      followsCount: p.followsCount,
    };

    // Get author clips
    const { rows } = await db.query(`
      SELECT mi.*, mt.text as transcript, mt.language,
             COALESCE(ic.like_count, 0) as like_count,
             COALESCE(ic.repost_count, 0) as repost_count
      FROM media_items mi
      LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
      LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
      WHERE mi.did = $1 AND mi.status = 'done' AND mi.error IS NULL
      ORDER BY mi.created_at DESC
      LIMIT 100
    `, [did]);

    items = await enrichMediaItems(rows);

    // Sum stats
    stats.video_count = items.length;
    stats.total_likes = items.reduce((acc, it) => acc + it.like_count, 0);
    stats.total_reposts = items.reduce((acc, it) => acc + it.repost_count, 0);

  } catch (err) {
    logger.error({ err, did }, 'Failed to fetch author profile');
  }

  const session = await getSessionUser(c);
  const pageHtml = AuthorPage({ profile, items, stats });
  return c.html(SnipLayout({ title: `${profile.displayName || profile.handle} — Profile`, children: pageHtml, session }));
});

// ── Post Details & Comment Threads ────────────────────────────────────────────
app.get('/post/:uri', async (c) => {
  const postUri = decodeURIComponent(c.req.param('uri'));
  let item: VideoItem | null = null;
  let thread: any = null;
  let related: VideoItem[] = [];

  try {
    // 1. Get video details
    const { rows } = await db.query(`
      SELECT mi.*, mt.text as transcript, mt.language, me.embedding,
             COALESCE(ic.like_count, 0) as like_count,
             COALESCE(ic.repost_count, 0) as repost_count
      FROM media_items mi
      LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
      LEFT JOIN media_embeddings me ON me.media_id = mi.id
      LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
      WHERE mi.uri = $1 AND mi.status = 'done' AND mi.error IS NULL
      LIMIT 1
    `, [postUri]);

    if (rows.length > 0) {
      const enriched = await enrichMediaItems(rows);
      item = enriched[0];

      // 2. Fetch related videos using OpenSearch (vector index)
      const hits = await getRelatedVideos(postUri, rows[0].embedding, rows[0].transcript, 4);
      if (hits.length > 0) {
        const relatedUris = hits.map((h: any) => h._source.uri);
        const { rows: relRows } = await db.query(`
          SELECT mi.*, mt.text as transcript, mt.language
          FROM media_items mi
          LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
          WHERE mi.uri = ANY($1) AND mi.status = 'done' AND mi.error IS NULL
        `, [relatedUris]);
        related = await enrichMediaItems(relRows);
      }
    }

    // 3. Get discussion thread from Bluesky anonymously
    const agent = new AtpAgent({ service: 'https://public.api.bsky.app' });
    const res = await agent.app.bsky.feed.getPostThread({ uri: postUri });
    thread = res.data.thread;

  } catch (err) {
    logger.error({ err, postUri }, 'Failed to load comments/detail page');
  }

  if (!item) {
    return c.text('Post not found in Snip database', 404);
  }

  // Build oEmbed discovery tag for this post
  const postPageUrl = `${SNIP_BASE}/post/${encodeURIComponent(postUri)}`;
  const postOembedTitle = item.post_text || item.alt_text || `Video by @${item.author_handle}`;
  const headExtra = html`${oembedDiscoveryTag(postPageUrl, postOembedTitle)}`;

  const session = await getSessionUser(c);
  const pageHtml = CommentsPage({ item, thread, related });
  return c.html(SnipLayout({ title: `Discussion on @${item.author_handle}'s post — Snip`, children: pageHtml, session, headExtra }));
});

// ── RSS Feeds ────────────────────────────────────────────────────────────────
const serveRssFeed = async (c: any, rows: any[], title: string, desc: string, link: string) => {
  const items = await enrichMediaItems(rows);
  const itemsXml = items.map(item => `
    <item>
      <title>${escapeXml(item.post_text || item.alt_text || 'Video clip')}</title>
      <link>${escapeXml(`https://snip.social/post/${encodeURIComponent(item.uri)}`)}</link>
      <guid isPermaLink="false">${escapeXml(item.uri)}</guid>
      <pubDate>${new Date(item.created_at).toUTCString()}</pubDate>
      <description>${escapeXml(item.transcript || '')}</description>
      <enclosure url="${escapeXml(item.source_url)}" length="0" type="video/mp4"/>
    </item>
  `).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(title)}</title>
    <description>${escapeXml(desc)}</description>
    <link>${escapeXml(link)}</link>
    ${itemsXml}
  </channel>
</rss>`;

  c.header('Content-Type', 'application/rss+xml; charset=utf-8');
  return c.body(xml);
};

app.get('/latest.rss', async (c) => {
  const { rows } = await db.query(`
    SELECT mi.*, mt.text as transcript, mt.language
    FROM media_items mi
    LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
    WHERE mi.status = 'done' AND mi.error IS NULL
    ORDER BY mi.created_at DESC
    LIMIT 30
  `);
  return serveRssFeed(c, rows, 'Snip.social — Latest Videos', 'Latest transcribed short video clips from Bluesky', 'https://snip.social/?type=latest');
});

app.get('/top.rss', async (c) => {
  const { rows } = await db.query(`
    SELECT mi.*, mt.text as transcript, mt.language,
           (COALESCE(ic.like_count, 0) + COALESCE(ic.repost_count, 0) * 2.0 + 1.0) / 
             POWER((EXTRACT(EPOCH FROM (NOW() - mi.created_at))/3600.0) + 2.0, 1.8) as score
    FROM media_items mi
    LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
    LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
    WHERE mi.status = 'done' AND mi.error IS NULL
    ORDER BY score DESC, mi.created_at DESC
    LIMIT 30
  `);
  return serveRssFeed(c, rows, 'Snip.social — Top Videos', 'Popular video clips from Bluesky ranked by community upvotes', 'https://snip.social/?type=top');
});

// ── Materialized View Refresh ────────────────────────────────────────────────
async function refreshInteractionCounts() {
  try {
    await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_media_interaction_counts');
    logger.debug('Refreshed mv_media_interaction_counts');
  } catch (err) {
    logger.error({ err }, 'Failed to refresh materialized view');
  }
}

// Launch server
serve({ fetch: app.fetch, port: SNIP_PORT }, (info) => {
  logger.info({ port: info.port }, 'Snip web server started');

  // Refresh interaction counts every 5 minutes
  refreshInteractionCounts();
  setInterval(refreshInteractionCounts, 5 * 60 * 1000);
});

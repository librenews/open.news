import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { getCachedProfile, getCachedProfiles } from '../lib/pdsCache.js';
import { searchMediaContent, getRelatedVideos } from '../track/opensearch.js';
import { SnipLayout, type SnipProfile } from './views/layout.js';
import { FeedPage, type VideoItem } from './views/feed.js';
import { AuthorPage, type AuthorProfile } from './views/author.js';
import { LeaderboardPage, type CreatorRow } from './views/leaderboard.js';
import { CommentsPage } from './views/comments.js';
import { AtpAgent } from '@atproto/api';
import { snipAuthRouter, getSessionUser } from './auth.js';

const app = new Hono();
const SNIP_PORT = parseInt(process.env.SNIP_PORT ?? '5100', 10);

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

// Helper: Fetch trending video terms
async function getTrendingTerms(limit = 8): Promise<string[]> {
  try {
    const { rows } = await db.query<{ word: string }>(`
      SELECT word, count(*) as count
      FROM (
        SELECT regexp_replace(regexp_split_to_table(lower(text), '\\s+'), '[^a-z]', '', 'g') as word
        FROM media_transcripts
        WHERE created_at > NOW() - INTERVAL '48 hours'
      ) words
      WHERE length(word) > 4
        AND word NOT IN (
          'about', 'above', 'after', 'again', 'against', 'along', 'among', 'around', 
          'because', 'before', 'being', 'below', 'between', 'could', 'didnt', 'doesnt', 
          'doing', 'during', 'either', 'first', 'going', 'great', 'havent', 'having', 
          'house', 'inside', 'might', 'never', 'other', 'people', 'really', 'should', 
          'since', 'their', 'there', 'these', 'thing', 'think', 'those', 'through', 
          'under', 'until', 'where', 'which', 'while', 'would', 'years', 'youre', 
          'about', 'every', 'would', 'something', 'about', 'right', 'doing', 'where', 
          'about', 'wants', 'being', 'better', 'where', 'another'
        )
      GROUP BY word
      ORDER BY count DESC
      LIMIT $1
    `, [limit]);
    return rows.map(r => r.word);
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

// ── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', async (c) => {
  return c.json({ status: 'ok', service: 'snip' });
});

// ── Homepage (Top / Latest Feed) ──────────────────────────────────────────────
app.get('/', async (c) => {
  const q = c.req.query('q') || '';
  const type = c.req.query('type') || 'top'; // top or latest
  const categoryName = c.req.query('category_name') || '';

  const trending = await getTrendingTerms(8);

  let items: VideoItem[] = [];

  try {
    if (q) {
      // Search mode using OpenSearch (limited to English language for high relevance)
      const hits = await searchMediaContent(q, 30);
      const postUris = hits.map((h: any) => h._source.uri);

      if (postUris.length > 0) {
        const { rows } = await db.query(`
          SELECT mi.*, mt.text as transcript, mt.language,
                 COALESCE(likes.count, 0) as like_count,
                 COALESCE(reposts.count, 0) as repost_count
          FROM media_items mi
          LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
          LEFT JOIN (SELECT media_uri, count(*) as count FROM media_interactions WHERE interaction_type = 'like' GROUP BY media_uri) likes ON likes.media_uri = mi.uri
          LEFT JOIN (SELECT media_uri, count(*) as count FROM media_interactions WHERE interaction_type = 'repost' GROUP BY media_uri) reposts ON reposts.media_uri = mi.uri
          WHERE mi.uri = ANY($1) AND mi.status = 'done' AND mi.error IS NULL AND mt.language = 'en'
        `, [postUris]);
        items = await enrichMediaItems(rows);
      }
    } else {
      // Browsing mode (English only)
      let queryStr = '';
      if (type === 'latest') {
        queryStr = `
          SELECT mi.*, mt.text as transcript, mt.language,
                 COALESCE(likes.count, 0) as like_count,
                 COALESCE(reposts.count, 0) as repost_count
          FROM media_items mi
          LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
          LEFT JOIN (SELECT media_uri, count(*) as count FROM media_interactions WHERE interaction_type = 'like' GROUP BY media_uri) likes ON likes.media_uri = mi.uri
          LEFT JOIN (SELECT media_uri, count(*) as count FROM media_interactions WHERE interaction_type = 'repost' GROUP BY media_uri) reposts ON reposts.media_uri = mi.uri
          WHERE mi.status = 'done' AND mi.error IS NULL AND mt.language = 'en'
          ORDER BY mi.created_at DESC
          LIMIT 25
        `;
      } else {
        // Hacker News algorithm (Likes + Reposts*2 + 1) / (Age + 2)^1.8
        queryStr = `
          SELECT mi.*, mt.text as transcript, mt.language,
                 COALESCE(likes.count, 0) as like_count,
                 COALESCE(reposts.count, 0) as repost_count,
                 (COALESCE(likes.count, 0) + COALESCE(reposts.count, 0) * 2.0 + 1.0) / 
                   POWER((EXTRACT(EPOCH FROM (NOW() - mi.created_at))/3600.0) + 2.0, 1.8) as score
          FROM media_items mi
          LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
          LEFT JOIN (SELECT media_uri, count(*) as count FROM media_interactions WHERE interaction_type = 'like' GROUP BY media_uri) likes ON likes.media_uri = mi.uri
          LEFT JOIN (SELECT media_uri, count(*) as count FROM media_interactions WHERE interaction_type = 'repost' GROUP BY media_uri) reposts ON reposts.media_uri = mi.uri
          WHERE mi.status = 'done' AND mi.error IS NULL AND mt.language = 'en'
          ORDER BY score DESC, mi.created_at DESC
          LIMIT 25
        `;
      }
      const { rows } = await db.query(queryStr);
      items = await enrichMediaItems(rows);
    }
  } catch (err) {
    logger.error({ err }, 'Failed to fetch homepage items');
  }

  const session = await getSessionUser(c);
  const pageHtml = FeedPage({ items, type, q, category: categoryName, trending });
  return c.html(SnipLayout({ title: 'Snip — High Signal ATProto Videos', children: pageHtml, q, type, session }));
});

// ── Leaderboard (Top Creators) ────────────────────────────────────────────────
app.get('/leaderboard', async (c) => {
  let creators: CreatorRow[] = [];
  try {
    const { rows } = await db.query(`
      SELECT mi.did,
             count(*) as video_count,
             COALESCE(sum(likes.count), 0) as total_likes,
             COALESCE(sum(reposts.count), 0) as total_reposts
      FROM media_items mi
      LEFT JOIN (SELECT media_uri, count(*) as count FROM media_interactions WHERE interaction_type = 'like' GROUP BY media_uri) likes ON likes.media_uri = mi.uri
      LEFT JOIN (SELECT media_uri, count(*) as count FROM media_interactions WHERE interaction_type = 'repost' GROUP BY media_uri) reposts ON reposts.media_uri = mi.uri
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
             COALESCE(likes.count, 0) as like_count,
             COALESCE(reposts.count, 0) as repost_count
      FROM media_items mi
      LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
      LEFT JOIN (SELECT media_uri, count(*) as count FROM media_interactions WHERE interaction_type = 'like' GROUP BY media_uri) likes ON likes.media_uri = mi.uri
      LEFT JOIN (SELECT media_uri, count(*) as count FROM media_interactions WHERE interaction_type = 'repost' GROUP BY media_uri) reposts ON reposts.media_uri = mi.uri
      WHERE mi.did = $1 AND mi.status = 'done' AND mi.error IS NULL
      ORDER BY mi.created_at DESC
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
             COALESCE(likes.count, 0) as like_count,
             COALESCE(reposts.count, 0) as repost_count
      FROM media_items mi
      LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
      LEFT JOIN media_embeddings me ON me.media_id = mi.id
      LEFT JOIN (SELECT media_uri, count(*) as count FROM media_interactions WHERE interaction_type = 'like' GROUP BY media_uri) likes ON likes.media_uri = mi.uri
      LEFT JOIN (SELECT media_uri, count(*) as count FROM media_interactions WHERE interaction_type = 'repost' GROUP BY media_uri) reposts ON reposts.media_uri = mi.uri
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

  const session = await getSessionUser(c);
  const pageHtml = CommentsPage({ item, thread, related });
  return c.html(SnipLayout({ title: `Discussion on @${item.author_handle}'s post — Snip`, children: pageHtml, session }));
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
           (COALESCE(likes.count, 0) + COALESCE(reposts.count, 0) * 2.0 + 1.0) / 
             POWER((EXTRACT(EPOCH FROM (NOW() - mi.created_at))/3600.0) + 2.0, 1.8) as score
    FROM media_items mi
    LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
    LEFT JOIN (SELECT media_uri, count(*) as count FROM media_interactions WHERE interaction_type = 'like' GROUP BY media_uri) likes ON likes.media_uri = mi.uri
    LEFT JOIN (SELECT media_uri, count(*) as count FROM media_interactions WHERE interaction_type = 'repost' GROUP BY media_uri) reposts ON reposts.media_uri = mi.uri
    WHERE mi.status = 'done' AND mi.error IS NULL
    ORDER BY score DESC, mi.created_at DESC
    LIMIT 30
  `);
  return serveRssFeed(c, rows, 'Snip.social — Top Videos', 'Popular video clips from Bluesky ranked by community upvotes', 'https://snip.social/?type=top');
});

// Launch server
serve({ fetch: app.fetch, port: SNIP_PORT }, (info) => {
  logger.info({ port: info.port }, 'Snip web server started');
});

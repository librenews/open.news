/**
 * RSS Feed — News-qualified videos from ONN.
 *
 * Routes:
 *   GET /rss/news          — all categories, reverse-chronological
 *   GET /rss/news/:category — filtered by category (politics, tech, finance, news, science)
 *
 * Each item includes:
 *   - Story label as title
 *   - Post text as description
 *   - Video enclosure (mp4) via the proxy URL
 *   - Author handle
 *   - Bluesky post link as guid
 */
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { config } from '../lib/config.js';

export const rssFeedRouter = new Hono();

const VALID_CATEGORIES = ['politics', 'tech', 'finance', 'news', 'science'];

interface NewsRow {
  media_id: number;
  media_uri: string;
  story_label: string;
  story_category: string | null;
  story_importance: number;
  match_confidence: number;
  composite_score: number;
  qualified_at: Date;
  did: string;
  cid: string | null;
  post_text: string | null;
  duration_ms: number | null;
  author_handle: string;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function atUriToHttps(atUri: string): string {
  // at://did:plc:xxx/app.bsky.feed.post/yyy → https://bsky.app/profile/did:plc:xxx/post/yyy
  const m = atUri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(.+)$/);
  if (m) return `https://bsky.app/profile/${m[1]}/post/${m[2]}`;
  return atUri;
}

function buildFeed(rows: NewsRow[], title: string, feedUrl: string): string {
  const baseUrl = config.BASE_URL;
  const now = new Date().toUTCString();

  const items = rows.map(row => {
    const postLink = atUriToHttps(row.media_uri);
    const videoUrl = row.did && row.cid
      ? `${baseUrl}/video/proxy/${encodeURIComponent(row.did)}/${encodeURIComponent(row.cid)}`
      : '';
    const description = row.post_text
      ? escapeXml(row.post_text)
      : escapeXml(`Video clip from @${row.author_handle} matched to story: ${row.story_label}`);
    const pubDate = new Date(row.qualified_at).toUTCString();
    const category = row.story_category ? `<category>${escapeXml(row.story_category)}</category>` : '';

    let enclosure = '';
    if (videoUrl) {
      // Estimate file size from duration (rough: 1MB per 10s of video)
      const lengthEstimate = row.duration_ms ? Math.round((row.duration_ms / 10000) * 1_000_000) : 5_000_000;
      enclosure = `<enclosure url="${escapeXml(videoUrl)}" length="${lengthEstimate}" type="video/mp4" />`;
    }

    return `    <item>
      <title>${escapeXml(row.story_label)}</title>
      <description>${description}</description>
      <link>${escapeXml(postLink)}</link>
      <guid isPermaLink="false">${escapeXml(row.media_uri)}</guid>
      <pubDate>${pubDate}</pubDate>
      <author>${escapeXml(row.author_handle)}</author>
      ${category}
      ${enclosure}
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>News-qualified video clips from the Open News Network</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <image>
      <url>${escapeXml(baseUrl)}/static/onn-logo.svg</url>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(baseUrl)}</link>
    </image>
${items}
  </channel>
</rss>`;
}

async function getNewsItems(category?: string, limit = 100): Promise<NewsRow[]> {
  let where = '';
  const params: any[] = [limit];

  if (category && VALID_CATEGORIES.includes(category)) {
    where = 'AND vnh.story_category = $2';
    params.push(category);
  }

  const { rows } = await db.query<NewsRow>(
    `SELECT vnh.media_id, vnh.media_uri, vnh.story_label, vnh.story_category,
            vnh.story_importance, vnh.match_confidence, vnh.composite_score,
            vnh.qualified_at,
            mi.did, mi.cid, mi.post_text, mi.duration_ms,
            COALESCE(
              (SELECT u.handle FROM users u WHERE u.did = mi.did LIMIT 1),
              mi.did
            ) as author_handle
     FROM video_news_history vnh
     JOIN media_items mi ON mi.id = vnh.media_id
     WHERE mi.cid IS NOT NULL ${where}
     ORDER BY vnh.qualified_at DESC
     LIMIT $1`,
    params
  );

  return rows;
}

// GET /rss/news — all categories
rssFeedRouter.get('/rss/news', async (c) => {
  const rows = await getNewsItems();
  const feedUrl = `${config.BASE_URL}/rss/news`;
  const xml = buildFeed(rows, 'ONN — All News', feedUrl);
  c.header('Content-Type', 'application/rss+xml; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=300'); // 5 min cache
  return c.body(xml);
});

// GET /rss/news/:category — filtered by category
rssFeedRouter.get('/rss/news/:category', async (c) => {
  const category = c.req.param('category');
  if (!VALID_CATEGORIES.includes(category)) {
    return c.text(`Invalid category. Valid: ${VALID_CATEGORIES.join(', ')}`, 400);
  }

  const CATEGORY_TITLES: Record<string, string> = {
    politics: 'ONN — Politics & Government',
    tech: 'ONN — Technology & AI',
    finance: 'ONN — Finance & Markets',
    news: 'ONN — Breaking News',
    science: 'ONN — Science & Nature',
  };

  const rows = await getNewsItems(category);
  const feedUrl = `${config.BASE_URL}/rss/news/${category}`;
  const xml = buildFeed(rows, CATEGORY_TITLES[category] || `ONN — ${category}`, feedUrl);
  c.header('Content-Type', 'application/rss+xml; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=300');
  return c.body(xml);
});

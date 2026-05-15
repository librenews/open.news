import { Hono } from 'hono';
import { html } from 'hono/html';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { EditorPage } from './views/editor.js';
import { PostsPage } from './views/posts.js';
import { ReaderPage } from './views/reader.js';
import { Layout } from './views/layout.js';
import { HomePage } from './views/home.js';
import { ProfilePage } from './views/profile.js';
import { SearchPage } from './views/search.js';
import { NotFoundPage } from './views/notfound.js';
import { SubscriptionsPage } from './views/subscriptions.js';
import { PublicationPage } from './views/publication.js';
import { generateRssFeed, type RssFeedItem } from './lib/rss.js';
import { runMigrations } from '../db/migrate.js';
import type { LongformStory } from './views/home.js';
import type { ProfileData } from './views/profile.js';
import type { SearchResult } from './views/search.js';
import { authRouter, getSession, getLongformAuthClient } from './routes/auth.js';
import { Agent, BskyAgent } from '@atproto/api';
import { serializeTiptapToLeaflet } from './lib/leafletExporter.js';
import { resolvePds } from '../lib/pds.js';
import { getCachedRecordMulti, getCachedProfile } from '../lib/pdsCache.js';
import { announcePublication, getLongformBot } from './bot.js';
import { Server as HocuspocusServer } from '@hocuspocus/server';
import { hocuspocusDb } from './lib/hocuspocusDb.js';
import { WebSocketServer } from 'ws';
import { db } from '../db/client.js';
import { searchSiteStandardArticles, getRelatedArticles } from '../track/opensearch.js';

process.on('unhandledRejection', (err) => {
  logger.warn({ err }, 'Caught unhandled promise rejection in Longform (likely a background OAuth token getter)');
});

const app = new Hono();

app.use('/logo.png', serveStatic({ root: './src/longform/public', path: 'logo.png' }));
app.use('/favicon.png', serveStatic({ root: './src/longform/public', path: 'favicon.png' }));

app.route('/', authRouter);

async function fetchUserProfile(did: string) {
  const p = await getCachedProfile(did);
  return { displayName: p.displayName, avatar: p.avatar, handle: p.handle };
}

/**
 * Safely restore an OAuth session. Returns the Agent session or null if the
 * session was deleted/expired (clears the cookie so the user is prompted to re-login).
 */
async function restoreSession(c: any, sessionDid: string): Promise<import('@atproto/api').AtpSessionData | null> {
  try {
    const client = await getLongformAuthClient();
    return await client.restore(sessionDid);
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('deleted') || msg.includes('revoked') || msg.includes('expired')) {
      logger.warn({ did: sessionDid, err: msg }, 'OAuth session invalid, clearing cookie');
      const { setCookie } = await import('hono/cookie');
      setCookie(c, 'lf_session', '', { maxAge: 0, path: '/' });
      return null;
    }
    throw err; // re-throw unexpected errors
  }
}

async function getOrCreateFeedToken(did: string): Promise<string> {
  const { rows } = await db.query('SELECT token FROM rss_feed_tokens WHERE did = $1', [did]);
  if (rows.length > 0) return rows[0].token;
  const { randomBytes } = await import('crypto');
  const token = randomBytes(24).toString('base64url');
  await db.query('INSERT INTO rss_feed_tokens (token, did) VALUES ($1, $2) ON CONFLICT (did) DO NOTHING', [token, did]);
  return token;
}

// Helper: Convert Leaflet plaintext + facets back to Tiptap inline content
function leafletTextToTiptap(plaintext: string, facets?: any[]): any[] {
  if (!plaintext) return [];
  if (!facets || facets.length === 0) return [{ type: 'text', text: plaintext }];

  const encoder = new TextEncoder();
  const bytes = encoder.encode(plaintext);
  
  // Build sorted facet ranges
  const sortedFacets = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart);
  const result: any[] = [];
  let bytePos = 0;

  for (const facet of sortedFacets) {
    const start = facet.index.byteStart;
    const end = facet.index.byteEnd;
    
    // Text before this facet
    if (start > bytePos) {
      const textBefore = new TextDecoder().decode(bytes.slice(bytePos, start));
      if (textBefore) result.push({ type: 'text', text: textBefore });
    }
    
    const facetText = new TextDecoder().decode(bytes.slice(start, end));
    if (facetText) {
      const marks: any[] = [];
      for (const feature of (facet.features || [])) {
        const ft = feature.$type || '';
        if (ft.includes('#bold')) marks.push({ type: 'bold' });
        else if (ft.includes('#italic')) marks.push({ type: 'italic' });
        else if (ft.includes('#strikethrough')) marks.push({ type: 'strike' });
        else if (ft.includes('#link')) marks.push({ type: 'link', attrs: { href: feature.uri || '' } });
      }
      result.push({ type: 'text', text: facetText, ...(marks.length > 0 ? { marks } : {}) });
    }
    bytePos = end;
  }

  // Remaining text after last facet
  if (bytePos < bytes.length) {
    const remaining = new TextDecoder().decode(bytes.slice(bytePos));
    if (remaining) result.push({ type: 'text', text: remaining });
  }

  return result;
}

// --- Edit published post ---
app.get('/edit/:rkey', async (c) => {
  const rkey = c.req.param('rkey');
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.redirect('/login');

  const profile = await fetchUserProfile(sessionDid);

  // Fetch the existing record — try PDS cache first, fall back to local DB
  let doc: any = null;
  let debugInfo: string[] = [];
  debugInfo.push(`rkey: ${rkey}`);
  debugInfo.push(`sessionDid: ${sessionDid}`);

  try {
    const result = await getCachedRecordMulti(
      sessionDid,
      ['site.standard.document', 'pub.leaflet.document'],
      rkey
    );
    if (result) {
      doc = result.record as any;
      debugInfo.push(`PDS cache: HIT (collection: ${result.collection})`);
    } else {
      debugInfo.push(`PDS cache: MISS (returned null)`);
    }
  } catch (err: any) {
    debugInfo.push(`PDS cache: ERROR - ${err.message}`);
  }

  // Fallback: load from local indexed DB
  if (!doc) {
    try {
      const likePattern = `%/${rkey}`;
      debugInfo.push(`DB query: uri LIKE '${likePattern}'`);
      const { rows } = await db.query(
        `SELECT uri, raw_record FROM site_standard_articles WHERE uri LIKE $1`,
        [likePattern]
      );
      debugInfo.push(`DB rows returned: ${rows.length}`);
      if (rows.length > 0) {
        debugInfo.push(`DB match URI: ${rows[0].uri}`);
        debugInfo.push(`DB raw_record is null: ${rows[0].raw_record === null}`);
        if (rows[0].raw_record) {
          doc = rows[0].raw_record;
          debugInfo.push(`DB fallback: LOADED`);
        }
      }
    } catch (err: any) {
      debugInfo.push(`DB fallback: ERROR - ${err.message}`);
    }
  }

  if (!doc) {
    return c.html(`<pre style="font-family:monospace;padding:2rem;">Edit Debug - Post Not Found\n\n${debugInfo.join('\n')}</pre>`, 404);
  }

  // Convert Leaflet blocks to Tiptap JSON
  const tiptapContent: any[] = [];
  // Add title as H1
  tiptapContent.push({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: doc.title || 'Untitled' }] });

  const pages = doc.content?.pages || doc.pages || [];
  if (pages.length > 0) {
    const blocks = pages[0].blocks || [];
    for (const block of blocks) {
      const b = block.block || block;
      const btype = b.$type || '';

      if (btype === 'pub.leaflet.blocks.text') {
        tiptapContent.push({ type: 'paragraph', content: leafletTextToTiptap(b.plaintext, b.facets) });
      } else if (btype === 'pub.leaflet.blocks.header') {
        tiptapContent.push({ type: 'heading', attrs: { level: b.level || 2 }, content: leafletTextToTiptap(b.plaintext, b.facets) });
      } else if (btype === 'pub.leaflet.blocks.blockquote') {
        tiptapContent.push({ type: 'blockquote', content: [{ type: 'paragraph', content: leafletTextToTiptap(b.plaintext, b.facets) }] });
      } else if (btype === 'pub.leaflet.blocks.code') {
        tiptapContent.push({ type: 'codeBlock', attrs: { language: b.language || null }, content: b.plaintext ? [{ type: 'text', text: b.plaintext }] : [] });
      } else if (btype === 'pub.leaflet.blocks.image') {
        const cid = b.image?.ref?.$link || b.image?.ref?.['$link'] || '';
        if (cid) tiptapContent.push({ type: 'image', attrs: { src: `/blob/${sessionDid}/${cid}`, alt: b.alt || '' } });
      } else if (btype === 'pub.leaflet.blocks.separator') {
        tiptapContent.push({ type: 'horizontalRule' });
      } else if (btype === 'pub.leaflet.blocks.iframe') {
        tiptapContent.push({ type: 'paragraph', content: [{ type: 'text', text: b.url || '' }] });
      } else if (b.plaintext) {
        tiptapContent.push({ type: 'paragraph', content: [{ type: 'text', text: b.plaintext }] });
      }
    }
  } else if (typeof doc.content === 'string') {
    for (const line of doc.content.split('\n')) {
      tiptapContent.push({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] });
    }
  }

  const tiptapJson = { type: 'doc', content: tiptapContent };
  const editUri = `at://${sessionDid}/site.standard.document/${rkey}`;

  const headerAction = html`
    <div style="display: flex; gap: 0.5rem; align-items: center;">
      <button onclick="window.togglePreview()" id="preview-btn" style="background: transparent; color: var(--text-main, #242424); border: 1px solid var(--border, rgba(0,0,0,0.15)); padding: 0.4rem 1.2rem; border-radius: 99px; cursor: pointer; font-family: var(--font-sans); font-weight: 500; font-size: 14px; transition: all 0.15s;">Preview</button>
      <button onclick="publishDraft()" id="publish-btn" style="background: #118156; color: white; border: none; padding: 0.4rem 1.2rem; border-radius: 99px; cursor: pointer; font-family: var(--font-sans); font-weight: 500; font-size: 14px;">Update</button>
    </div>
  `;

  return c.html((
    <Layout title={`Edit - ${doc.title} - ${config.LONGFORM_DOMAIN}`} profile={profile} headerAction={headerAction}>
      <script dangerouslySetInnerHTML={{ __html: `
        window.SESSION_DID = ${JSON.stringify(sessionDid)};
        window.SESSION_HANDLE = ${JSON.stringify(profile?.handle || sessionDid)};
        window.EDIT_URI = ${JSON.stringify(editUri)};
        window.EDIT_TIPTAP_JSON = ${JSON.stringify(tiptapJson)};
      ` }} />
      <EditorPage />
    </Layout>
  ) as unknown as string);
});

app.get('/', async (c) => {
  const sessionDid = await getSession(c);
  const docId = c.req.query('doc');

  // If ?doc= param, show editor (requires login)
  if (docId) {
    if (!sessionDid) return c.redirect('/login');
    const profile = await fetchUserProfile(sessionDid);
    const headerAction = html`
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        <button onclick="window.openShareModal()" id="share-btn" style="display: none; background: #242424; color: white; border: none; padding: 0.4rem 1.2rem; border-radius: 99px; cursor: pointer; font-family: var(--font-sans); font-weight: 500; font-size: 14px;">Share</button>
        <button onclick="window.togglePreview()" id="preview-btn" style="background: transparent; color: var(--text-main, #242424); border: 1px solid var(--border, rgba(0,0,0,0.15)); padding: 0.4rem 1.2rem; border-radius: 99px; cursor: pointer; font-family: var(--font-sans); font-weight: 500; font-size: 14px; transition: all 0.15s;">Preview</button>
        <button onclick="publishDraft()" id="publish-btn" style="background: #118156; color: white; border: none; padding: 0.4rem 1.2rem; border-radius: 99px; cursor: pointer; font-family: var(--font-sans); font-weight: 500; font-size: 14px;">Publish</button>
      </div>
    `;
    return c.html((
      <Layout title={`Draft - ${config.LONGFORM_DOMAIN}`} profile={profile} headerAction={headerAction}>
        <script dangerouslySetInnerHTML={{ __html: `window.SESSION_DID = ${JSON.stringify(sessionDid)}; window.SESSION_HANDLE = ${JSON.stringify(profile?.handle || sessionDid)};` }} />
        <EditorPage />
      </Layout>
    ) as unknown as string);
  }

  // Home page — show indexed longform articles
  const view = (c.req.query('view') || 'latest') as 'latest' | 'foryou' | 'following';
  const profile = sessionDid ? await fetchUserProfile(sessionDid) : null;

  // For the "following" tab, fetch the user's subscriptions
  let followedPubUris: string[] = [];
  if (view === 'following' && sessionDid) {
    try {
      const oauthSession = await restoreSession(c, sessionDid);
      if (!oauthSession) { return c.redirect('/login'); }
      const agent = new Agent(oauthSession);
      const res = await agent.com.atproto.repo.listRecords({
        repo: sessionDid,
        collection: 'site.standard.graph.subscription',
        limit: 100,
      });
      followedPubUris = (res.data.records || [])
        .map((r: any) => r.value?.publication)
        .filter((u: any): u is string => typeof u === 'string');
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch user subscriptions for Following tab');
    }
  }

  if (view === 'following' && followedPubUris.length === 0) {
    // No subscriptions — skip query, show empty state
    const topics: { label: string; count: number; slug: string }[] = [];
    const feedToken = sessionDid ? await getOrCreateFeedToken(sessionDid) : null;
    return c.html((<HomePage stories={[]} topics={topics} view={view} profile={profile} domain={config.LONGFORM_DOMAIN} hasSubscriptions={false} feedToken={feedToken} />) as unknown as string);
  }

  // Build the query — add publication filter for "following" view
  let queryText: string;
  let queryParams: any[] = [];

  if (view === 'following' && followedPubUris.length > 0) {
    queryText = `SELECT s.uri, s.author_did, s.title, s.description, s.published_at, COALESCE(p.url, s.site) as site, s.path, s.word_count,
       split_part(s.uri, '/', 4) AS collection,
       CASE WHEN s.uri LIKE '%/site.standard.document/%' OR s.uri LIKE '%/pub.leaflet.document/%'
         THEN jsonb_path_query_first(s.raw_record, '$.content.pages[0].blocks[*].block ? (@."$type" == "pub.leaflet.blocks.image").image.ref."$link"') #>> '{}'
         ELSE NULL
       END AS image_cid,
       CASE WHEN s.raw_record->>'site' LIKE 'at://%site.standard.publication%'
         THEN s.raw_record->>'site'
         ELSE NULL
       END AS publication_uri,
       s.raw_record->>'tags' AS tags_json
     FROM site_standard_articles s
     LEFT JOIN site_publications p ON p.uri = s.raw_record->>'site'
     WHERE s.word_count > 100
       AND s.language = 'eng'
       AND s.raw_record->>'site' = ANY($1)
     ORDER BY s.published_at DESC NULLS LAST
     LIMIT 40`;
    queryParams = [followedPubUris];
  } else {
    queryText = `SELECT s.uri, s.author_did, s.title, s.description, s.published_at, COALESCE(p.url, s.site) as site, s.path, s.word_count,
       split_part(s.uri, '/', 4) AS collection,
       CASE WHEN s.uri LIKE '%/site.standard.document/%' OR s.uri LIKE '%/pub.leaflet.document/%'
         THEN jsonb_path_query_first(s.raw_record, '$.content.pages[0].blocks[*].block ? (@."$type" == "pub.leaflet.blocks.image").image.ref."$link"') #>> '{}'
         ELSE NULL
       END AS image_cid,
       CASE WHEN s.raw_record->>'site' LIKE 'at://%site.standard.publication%'
         THEN s.raw_record->>'site'
         ELSE NULL
       END AS publication_uri,
       s.raw_record->>'tags' AS tags_json
     FROM site_standard_articles s
     LEFT JOIN site_publications p ON p.uri = s.raw_record->>'site'
     WHERE s.word_count > 100
       AND s.language = 'eng'
     ORDER BY s.published_at DESC NULLS LAST
     LIMIT 40`;
  }

  const { rows } = await db.query(queryText, queryParams);

  // Batch fetch author profiles (deduplicate DIDs)
  const uniqueDids = [...new Set(rows.map((r: any) => r.author_did))];
  const profileMap = new Map<string, { displayName: string; avatar: string; handle: string }>();
  await Promise.all(uniqueDids.map(async (did) => {
    const p = await fetchUserProfile(did as string);
    profileMap.set(did as string, p);
  }));

  const stories: LongformStory[] = rows.map((r: any) => {
    const p = profileMap.get(r.author_did) || { displayName: r.author_did, avatar: '', handle: r.author_did };
    const rkey = r.uri.split('/').pop();
    const collection = r.collection;

    // StoryCard will use /post/:did/:rkey (native reader)
    let readUrl: string | null = null;

    return {
      uri: r.uri,
      authorDid: r.author_did,
      authorHandle: p.handle,
      authorAvatar: p.avatar,
      authorName: p.displayName,
      title: r.title,
      description: r.description,
      publishedAt: r.published_at?.toISOString() ?? null,
      site: r.site,
      path: r.path,
      wordCount: r.word_count || 0,
      imageUrl: r.image_cid ? `/blob/${r.author_did}/${r.image_cid}` : null,
      externalUrl: readUrl,
      publicationUri: r.publication_uri || null,
      tags: (() => { try { return r.tags_json ? JSON.parse(r.tags_json) : []; } catch { return []; } })(),
    };
  });

  // Topics placeholder — we'll populate this later
  const topics: { label: string; count: number; slug: string }[] = [];

  // Track whether the user has any subscriptions (for empty state on Following tab)
  const hasSubscriptions = followedPubUris.length > 0;

  // Fetch popular posts using engagement counts with time decay
  let popularPosts: any[] = [];
  try {
    const { rows: popRows } = await db.query(`
      SELECT
        s.uri, s.author_did, s.title, s.published_at,
        COUNT(CASE WHEN ai.interaction_type = 'like' THEN 1 END) AS like_count,
        COUNT(CASE WHEN ai.interaction_type = 'repost' THEN 1 END) AS repost_count,
        COUNT(*) AS total_interactions,
        -- Time decay: score = interactions * exp(-age_in_days / 7)
        COUNT(*) * EXP(-EXTRACT(EPOCH FROM (NOW() - s.published_at)) / (7 * 86400)) AS decay_score
      FROM article_interactions ai
      JOIN site_standard_articles s ON s.uri = ai.article_uri
      WHERE s.published_at > NOW() - INTERVAL '30 days'
        AND s.word_count > 100
        AND s.language = 'eng'
      GROUP BY s.uri, s.author_did, s.title, s.published_at
      HAVING COUNT(*) >= 1
      ORDER BY decay_score DESC
      LIMIT 5
    `);

    const popDids = [...new Set(popRows.map((r: any) => r.author_did))];
    const popProfileMap = new Map<string, any>();
    await Promise.all(popDids.map(async (did) => {
      const p = await fetchUserProfile(did as string);
      popProfileMap.set(did as string, p);
    }));

    popularPosts = popRows.map((r: any) => {
      const p = popProfileMap.get(r.author_did) || { displayName: r.author_did, avatar: '', handle: r.author_did };
      return {
        uri: r.uri,
        authorDid: r.author_did,
        authorName: p.displayName,
        authorHandle: p.handle,
        authorAvatar: p.avatar,
        title: r.title,
        publishedAt: r.published_at?.toISOString() ?? null,
        likeCount: parseInt(r.like_count) || 0,
        repostCount: parseInt(r.repost_count) || 0,
      };
    });
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch popular posts');
  }

  // Fetch trending tags (last 7 days)
  let trendingTags: { tag: string; count: number }[] = [];
  try {
    const { rows: tagRows } = await db.query(`
      SELECT tag, COUNT(*) AS cnt
      FROM site_standard_articles s,
           jsonb_array_elements_text(s.raw_record->'tags') AS tag
      WHERE s.word_count > 100 AND s.language = 'eng'
        AND s.published_at > NOW() - INTERVAL '7 days'
      GROUP BY tag
      ORDER BY cnt DESC
      LIMIT 20
    `);
    trendingTags = tagRows.map((r: any) => ({ tag: r.tag, count: parseInt(r.cnt) }));
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch trending tags');
  }

  const feedToken = sessionDid ? await getOrCreateFeedToken(sessionDid) : null;
  return c.html((<HomePage stories={stories} topics={topics} view={view} profile={profile} domain={config.LONGFORM_DOMAIN} hasSubscriptions={hasSubscriptions} popularPosts={popularPosts} feedToken={feedToken} trendingTags={trendingTags} />) as unknown as string);
});

// --- Tag page ---

app.get('/tag/:tag', async (c) => {
  const tag = decodeURIComponent(c.req.param('tag'));
  const sessionDid = await getSession(c);
  const profile = sessionDid ? await fetchUserProfile(sessionDid) : null;

  const { rows } = await db.query(
    `SELECT s.uri, s.author_did, s.title, s.description, s.published_at, COALESCE(p.url, s.site) as site, s.path, s.word_count,
       split_part(s.uri, '/', 4) AS collection,
       CASE WHEN s.uri LIKE '%/site.standard.document/%' OR s.uri LIKE '%/pub.leaflet.document/%'
         THEN jsonb_path_query_first(s.raw_record, '$.content.pages[0].blocks[*].block ? (@."$type" == "pub.leaflet.blocks.image").image.ref."$link"') #>> '{}'
         ELSE NULL
       END AS image_cid,
       CASE WHEN s.raw_record->>'site' LIKE 'at://%site.standard.publication%'
         THEN s.raw_record->>'site'
         ELSE NULL
       END AS publication_uri,
       s.raw_record->>'tags' AS tags_json
     FROM site_standard_articles s
     LEFT JOIN site_publications p ON p.uri = s.raw_record->>'site'
     WHERE s.word_count > 100
       AND s.language = 'eng'
       AND s.raw_record->'tags' ? $1
     ORDER BY s.published_at DESC NULLS LAST
     LIMIT 40`,
    [tag]
  );

  const uniqueDids = [...new Set(rows.map((r: any) => r.author_did))];
  const profileMap = new Map<string, { displayName: string; avatar: string; handle: string }>();
  await Promise.all(uniqueDids.map(async (did) => {
    const p = await fetchUserProfile(did as string);
    profileMap.set(did as string, p);
  }));

  const stories: LongformStory[] = rows.map((r: any) => {
    const p = profileMap.get(r.author_did) || { displayName: r.author_did, avatar: '', handle: r.author_did };
    return {
      uri: r.uri,
      authorDid: r.author_did,
      authorHandle: p.handle,
      authorAvatar: p.avatar,
      authorName: p.displayName,
      title: r.title,
      description: r.description,
      publishedAt: r.published_at?.toISOString() ?? null,
      site: r.site,
      path: r.path,
      wordCount: r.word_count || 0,
      imageUrl: r.image_cid ? `/blob/${r.author_did}/${r.image_cid}` : null,
      externalUrl: null,
      publicationUri: r.publication_uri || null,
      tags: (() => { try { return r.tags_json ? JSON.parse(r.tags_json) : []; } catch { return []; } })(),
    };
  });

  const feedToken = sessionDid ? await getOrCreateFeedToken(sessionDid) : null;
  return c.html((<HomePage stories={stories} topics={[]} view={'latest'} profile={profile} domain={config.LONGFORM_DOMAIN} hasSubscriptions={false} feedToken={feedToken} trendingTags={[]} pageTitle={`#${tag}`} pageRssUrl={`/feed/tag/${encodeURIComponent(tag)}.xml`} />) as unknown as string);
});

// --- Tag RSS feed ---

app.get('/feed/tag/:tag.xml', async (c) => {
  const tag = decodeURIComponent(c.req.param('tag'));

  const { rows } = await db.query(
    `SELECT s.uri, s.author_did, s.title, s.description, s.published_at, s.word_count,
       s.raw_record->>'tags' as all_tags_json
     FROM site_standard_articles s
     WHERE s.word_count > 100 AND s.language = 'eng'
       AND s.raw_record->'tags' ? $1
     ORDER BY s.published_at DESC NULLS LAST
     LIMIT 30`,
    [tag]
  );

  const uniqueDids = [...new Set(rows.map((r: any) => r.author_did))];
  const profileMap = new Map<string, { displayName: string; avatar: string; handle: string }>();
  await Promise.all(uniqueDids.map(async (did) => {
    const p = await fetchUserProfile(did as string);
    profileMap.set(did as string, p);
  }));

  const baseUrl = `https://${config.LONGFORM_DOMAIN}`;
  const items: RssFeedItem[] = rows.map((r: any) => {
    const p = profileMap.get(r.author_did) || { displayName: r.author_did, avatar: '', handle: r.author_did };
    const rkey = r.uri.split('/').pop();
    let tags: string[] = [];
    try { if (r.all_tags_json) tags = JSON.parse(r.all_tags_json); } catch {}
    return {
      title: r.title || 'Untitled',
      link: `${baseUrl}/post/${r.author_did}/${rkey}`,
      description: r.description || '',
      authorName: p.displayName,
      authorUri: `${baseUrl}/profile/${p.handle}`,
      pubDate: r.published_at?.toISOString() ?? null,
      guid: r.uri,
      wordCount: r.word_count || 0,
      categories: tags,
    };
  });

  const xml = generateRssFeed({
    title: `Longform — #${tag}`,
    description: `Latest longform articles tagged "${tag}"`,
    link: `${baseUrl}/tag/${encodeURIComponent(tag)}`,
    feedUrl: `${baseUrl}/feed/tag/${encodeURIComponent(tag)}.xml`,
    imageUrl: `${baseUrl}/logo.png`,
    items,
  });

  return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
});

// --- RSS Feeds ---

app.get('/feed/latest.xml', async (c) => {
  const { rows } = await db.query(
    `SELECT s.uri, s.author_did, s.title, s.description, s.published_at, s.word_count,
       s.raw_record->>'tags' as tags_json,
       CASE WHEN s.uri LIKE '%/site.standard.document/%' OR s.uri LIKE '%/pub.leaflet.document/%'
         THEN jsonb_path_query_first(s.raw_record, '$.content.pages[0].blocks[*].block ? (@."$type" == "pub.leaflet.blocks.image").image.ref."$link"') #>> '{}'
         ELSE NULL
       END AS image_cid
     FROM site_standard_articles s
     WHERE s.word_count > 100 AND s.language = 'eng'
     ORDER BY s.published_at DESC NULLS LAST
     LIMIT 30`
  );

  const uniqueDids = [...new Set(rows.map((r: any) => r.author_did))];
  const profileMap = new Map<string, { displayName: string; avatar: string; handle: string }>();
  await Promise.all(uniqueDids.map(async (did) => {
    const p = await fetchUserProfile(did as string);
    profileMap.set(did as string, p);
  }));

  const baseUrl = `https://${config.LONGFORM_DOMAIN}`;
  const items: RssFeedItem[] = rows.map((r: any) => {
    const p = profileMap.get(r.author_did) || { displayName: r.author_did, avatar: '', handle: r.author_did };
    const rkey = r.uri.split('/').pop();
    let tags: string[] = [];
    try { if (r.tags_json) tags = JSON.parse(r.tags_json); } catch {}
    return {
      title: r.title || 'Untitled',
      link: `${baseUrl}/post/${r.author_did}/${rkey}`,
      description: r.description || '',
      authorName: p.displayName,
      authorUri: `${baseUrl}/profile/${p.handle}`,
      pubDate: r.published_at?.toISOString() ?? null,
      guid: r.uri,
      imageUrl: r.image_cid ? `${baseUrl}/blob/${r.author_did}/${r.image_cid}` : null,
      wordCount: r.word_count || 0,
      categories: tags,
    };
  });

  const xml = generateRssFeed({
    title: 'Longform — Latest',
    description: 'The latest longform articles from across the AT Protocol',
    link: baseUrl,
    feedUrl: `${baseUrl}/feed/latest.xml`,
    imageUrl: `${baseUrl}/logo.png`,
    items,
  });

  return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
});

app.get('/feed/following.xml', async (c) => {
  const token = c.req.query('token');
  let userDid: string | null = null;

  if (token) {
    // Token-based access (RSS readers)
    const { rows } = await db.query('SELECT did FROM rss_feed_tokens WHERE token = $1', [token]);
    if (rows.length === 0) return c.text('Invalid or expired feed token', 403);
    userDid = rows[0].did;
    // Update last_used_at
    db.query('UPDATE rss_feed_tokens SET last_used_at = now() WHERE token = $1', [token]).catch(() => {});
  } else {
    // Session-based access (browser) — generate token if needed and redirect
    const sessionDid = await getSession(c);
    if (!sessionDid) return c.text('Sign in required. Visit longform.social to get your personal feed URL.', 401);
    userDid = sessionDid;
    const feedToken = await getOrCreateFeedToken(sessionDid);
    return c.redirect(`/feed/following.xml?token=${feedToken}`);
  }

  // Fetch subscriptions from user's PDS (public, no auth needed)
  let followedPubUris: string[] = [];
  try {
    const pdsEndpoint = await resolvePds(userDid);
    const publicAgent = new BskyAgent({ service: pdsEndpoint });
    const res = await publicAgent.com.atproto.repo.listRecords({
      repo: userDid,
      collection: 'site.standard.graph.subscription',
      limit: 100,
    });
    followedPubUris = (res.data.records || [])
      .map((r: any) => r.value?.publication)
      .filter((u: any): u is string => typeof u === 'string');
  } catch (err) {
    logger.warn({ err, did: userDid }, 'Failed to fetch subscriptions for RSS feed');
  }

  let items: RssFeedItem[] = [];
  if (followedPubUris.length > 0) {
    const { rows } = await db.query(
      `SELECT s.uri, s.author_did, s.title, s.description, s.published_at, s.word_count,
         s.raw_record->>'tags' as tags_json,
         CASE WHEN s.uri LIKE '%/site.standard.document/%' OR s.uri LIKE '%/pub.leaflet.document/%'
           THEN jsonb_path_query_first(s.raw_record, '$.content.pages[0].blocks[*].block ? (@."$type" == "pub.leaflet.blocks.image").image.ref."$link"') #>> '{}'
           ELSE NULL
         END AS image_cid
       FROM site_standard_articles s
       WHERE s.word_count > 100 AND s.language = 'eng'
         AND s.raw_record->>'site' = ANY($1)
       ORDER BY s.published_at DESC NULLS LAST
       LIMIT 30`,
      [followedPubUris]
    );

    const uniqueDids = [...new Set(rows.map((r: any) => r.author_did))];
    const profileMap = new Map<string, { displayName: string; avatar: string; handle: string }>();
    await Promise.all(uniqueDids.map(async (did) => {
      const p = await fetchUserProfile(did as string);
      profileMap.set(did as string, p);
    }));

    const baseUrl = `https://${config.LONGFORM_DOMAIN}`;
    items = rows.map((r: any) => {
      const p = profileMap.get(r.author_did) || { displayName: r.author_did, avatar: '', handle: r.author_did };
      const rkey = r.uri.split('/').pop();
      let tags: string[] = [];
      try { if (r.tags_json) tags = JSON.parse(r.tags_json); } catch {}
      return {
        title: r.title || 'Untitled',
        link: `${baseUrl}/post/${r.author_did}/${rkey}`,
        description: r.description || '',
        authorName: p.displayName,
        authorUri: `${baseUrl}/profile/${p.handle}`,
        pubDate: r.published_at?.toISOString() ?? null,
        guid: r.uri,
        imageUrl: r.image_cid ? `${baseUrl}/blob/${r.author_did}/${r.image_cid}` : null,
        wordCount: r.word_count || 0,
        categories: tags,
      };
    });
  }

  const baseUrl = `https://${config.LONGFORM_DOMAIN}`;
  const xml = generateRssFeed({
    title: 'Longform — Following',
    description: 'Articles from publications you follow',
    link: `${baseUrl}/?view=following`,
    feedUrl: `${baseUrl}/feed/following.xml?token=${token}`,
    imageUrl: `${baseUrl}/logo.png`,
    items,
  });

  return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
});

app.get('/feed/search.xml', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.text('Query required: /feed/search.xml?q=...', 400);

  let items: RssFeedItem[] = [];
  try {
    const hits = await searchSiteStandardArticles(q, 'long', 'recent', 30);

    const uniqueDids = [...new Set((hits.hits || []).map((h: any) => h._source.did))];
    const profileMap = new Map<string, { displayName: string; avatar: string; handle: string }>();
    await Promise.all(uniqueDids.map(async (did) => {
      const p = await fetchUserProfile(did as string);
      profileMap.set(did as string, p);
    }));

    const baseUrl = `https://${config.LONGFORM_DOMAIN}`;
    items = (hits.hits || []).map((hit: any) => {
      const s = hit._source;
      const p = profileMap.get(s.did) || { displayName: s.did, avatar: '', handle: s.did };
      const rkey = s.uri.split('/').pop();
      return {
        title: s.title || 'Untitled',
        link: `${baseUrl}/post/${s.did}/${rkey}`,
        description: s.description || '',
        authorName: p.displayName,
        authorUri: `${baseUrl}/profile/${p.handle}`,
        pubDate: s.published_at || null,
        guid: s.uri,
        wordCount: s.word_count || 0,
      };
    });
  } catch (err: any) {
    logger.error({ err, q }, 'Search RSS feed failed');
  }

  const baseUrl = `https://${config.LONGFORM_DOMAIN}`;
  const xml = generateRssFeed({
    title: `Longform — "${q}"`,
    description: `Latest articles matching "${q}"`,
    link: `${baseUrl}/search?q=${encodeURIComponent(q)}&sort=latest`,
    feedUrl: `${baseUrl}/feed/search.xml?q=${encodeURIComponent(q)}`,
    imageUrl: `${baseUrl}/logo.png`,
    items,
  });

  return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
});

app.get('/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const sort = (c.req.query('sort') || 'relevant') as 'relevant' | 'latest';
  const sessionDid = await getSession(c);
  const profile = sessionDid ? await fetchUserProfile(sessionDid) : null;

  let results: SearchResult[] = [];

  if (q) {
    try {
      const osSort = sort === 'latest' ? 'recent' : 'relevant';
      const hits = await searchSiteStandardArticles(q, 'long', osSort, 30);

      const uniqueDids = [...new Set((hits.hits || []).map((h: any) => h._source.did))];
      const profileMap = new Map<string, { displayName: string; avatar: string; handle: string }>();
      await Promise.all(uniqueDids.map(async (did) => {
        const p = await fetchUserProfile(did as string);
        profileMap.set(did as string, p);
      }));

      results = (hits.hits || []).map((hit: any) => {
        const s = hit._source;
        const p = profileMap.get(s.did) || { displayName: s.did, avatar: '', handle: s.did };
        const highlights = hit.highlight || {};
        const textHighlights = Object.keys(highlights)
          .filter(k => k.startsWith('text_content'))
          .flatMap(k => highlights[k]);

        return {
          uri: s.uri,
          did: s.did,
          title: s.title || 'Untitled',
          site: s.site || null,
          path: s.path || null,
          publishedAt: s.published_at || null,
          wordCount: s.word_count || 0,
          highlight: textHighlights.length > 0 ? textHighlights[0] : null,
          authorHandle: p.handle,
          authorName: p.displayName,
          authorAvatar: p.avatar,
        };
      });
    } catch (err: any) {
      logger.error({ err, q }, 'Search failed');
    }
  }

  return c.html((<SearchPage query={q} results={results} sort={sort} profile={profile} domain={config.LONGFORM_DOMAIN} />) as unknown as string);
});

app.get('/login', async (c) => {
  const sessionDid = await getSession(c);
  if (sessionDid) return c.redirect('/');

  return c.html((<Layout title={`Sign in — Longform`}>
    <div style="text-align: center; padding-top: 15vh;">
      <img src="/logo.png" alt="Longform" style="height: 64px; margin-bottom: 0.5rem;" onerror="this.outerHTML='<h1 style=\'font-family: var(--font-body); font-weight: 700; font-size: 54px; color: var(--text-main); letter-spacing: -0.03em; margin-bottom: 0.5rem;\'>Longform</h1>'" />
      <p style="color: var(--text-muted); font-family: var(--font-sans); margin-bottom: 3rem; font-size: 18px;">Sign in with your AT Protocol identity to write and publish.</p>
      <form action="/oauth/login" method="get">
        <input
          type="text"
          name="handle"
          placeholder="e.g. alice.bsky.social"
          style="padding: 0.75rem 1rem; border: 1px solid rgba(0,0,0,0.2); border-radius: 6px; font-size: 16px; margin-right: 0.5rem; width: 260px; font-family: var(--font-sans);"
          required
        />
        <button
          type="submit"
          style="padding: 0.75rem 1.5rem; background: #242424; color: white; border: none; border-radius: 6px; font-size: 16px; cursor: pointer; font-family: var(--font-sans); font-weight: 500;"
        >Sign In</button>
      </form>
    </div>
  </Layout>) as unknown as string);
});

app.get('/subscriptions', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.redirect('/login');
  const profile = sessionDid ? await fetchUserProfile(sessionDid) : null;

  try {
    const oauthSession = await restoreSession(c, sessionDid);
    if (!oauthSession) return c.redirect('/login');
    const agent = new Agent(oauthSession);

    // Fetch all subscription records from user's PDS
    const res = await agent.com.atproto.repo.listRecords({
      repo: sessionDid,
      collection: 'site.standard.graph.subscription',
      limit: 100,
    });

    const subscriptions = [];
    for (const record of (res.data.records || [])) {
      const pubUri = (record.value as any)?.publication;
      if (!pubUri || typeof pubUri !== 'string') continue;

      const rkey = record.uri.split('/').pop() || '';
      const createdAt = (record.value as any)?.createdAt || null;

      // Try to resolve publication details
      let pubTitle: string | null = null;
      let pubUrl: string | null = null;
      let authorDid = '';
      let authorHandle = '';
      let authorAvatar = '';
      let authorName = '';

      // Extract DID from publication URI
      if (pubUri.startsWith('at://')) {
        const parts = pubUri.replace('at://', '').split('/');
        authorDid = parts[0];
        const collection = parts[1];
        const pubRkey = parts[2];

        // Try local cache first
        const { rows } = await db.query('SELECT url, raw_record FROM site_publications WHERE uri = $1', [pubUri]);
        if (rows.length > 0) {
          pubUrl = rows[0].url;
          pubTitle = rows[0].raw_record?.name || rows[0].raw_record?.title || null;
        } else {
          // Fetch from PDS
          try {
            const pdsEndpoint = await resolvePds(authorDid);
            if (pdsEndpoint) {
              const fetchAgent = new BskyAgent({ service: pdsEndpoint });
              const pdsRes = await fetchAgent.com.atproto.repo.getRecord({
                repo: authorDid, collection, rkey: pubRkey
              });
              pubUrl = (pdsRes.data.value as any).url || null;
              pubTitle = (pdsRes.data.value as any).name || (pdsRes.data.value as any).title || null;
            }
          } catch (e) { /* could not resolve */ }
        }

        // Resolve author profile
        const authorProfile = await fetchUserProfile(authorDid);
        authorHandle = authorProfile.handle;
        authorAvatar = authorProfile.avatar;
        authorName = authorProfile.displayName;
      }

      subscriptions.push({
        rkey,
        publicationUri: pubUri,
        publicationTitle: pubTitle,
        publicationUrl: pubUrl,
        authorDid,
        authorHandle,
        authorAvatar,
        authorName,
        createdAt,
      });
    }

    return c.html(
      <Layout title={`Subscriptions - ${config.LONGFORM_DOMAIN}`} profile={profile}>
        {SubscriptionsPage({ subscriptions, domain: config.LONGFORM_DOMAIN, profile, feedToken: await getOrCreateFeedToken(sessionDid) })}
      </Layout> as unknown as string
    );
  } catch (err: any) {
    logger.error({ err }, 'Failed to load subscriptions page');
    return c.html(
      <Layout title={`Subscriptions - ${config.LONGFORM_DOMAIN}`} profile={profile}>
        {SubscriptionsPage({ subscriptions: [], domain: config.LONGFORM_DOMAIN, profile, feedToken: await getOrCreateFeedToken(sessionDid) })}
      </Layout> as unknown as string
    );
  }
});

// --- Publication detail page ---
app.get('/publication/:did/:rkey', async (c) => {
  const did = c.req.param('did');
  const rkey = c.req.param('rkey');
  const sessionDid = await getSession(c);
  const sessionProfile = sessionDid ? await fetchUserProfile(sessionDid) : null;

  // Try to fetch publication record from PDS
  const collections = ['site.standard.publication', 'pub.leaflet.publication'];
  let pubRecord: any = null;
  let pubCollection = '';

  for (const col of collections) {
    try {
      const pdsEndpoint = await resolvePds(did);
      if (!pdsEndpoint) continue;
      const agent = new BskyAgent({ service: pdsEndpoint });
      const res = await agent.com.atproto.repo.getRecord({ repo: did, collection: col, rkey });
      pubRecord = res.data.value;
      pubCollection = col;
      break;
    } catch (e) { continue; }
  }

  if (!pubRecord) {
    return c.html((<Layout title={`Publication Not Found - ${config.LONGFORM_DOMAIN}`} profile={sessionProfile}><NotFoundPage /></Layout>) as unknown as string, 404);
  }

  // Resolve author profile
  const authorProfile = await fetchUserProfile(did);
  const pubUri = `at://${did}/${pubCollection}/${rkey}`;

  // Query articles from this publication
  const { rows } = await db.query(
    `SELECT s.uri, s.author_did, s.title, s.description, s.published_at, s.word_count
     FROM site_standard_articles s
     WHERE s.raw_record->>'site' = $1
     ORDER BY s.published_at DESC NULLS LAST
     LIMIT 100`,
    [pubUri]
  );

  // Batch resolve author profiles for articles
  const articleDids = [...new Set(rows.map((r: any) => r.author_did))];
  const articleProfileMap = new Map<string, { displayName: string; avatar: string; handle: string }>();
  await Promise.all(articleDids.map(async (d) => {
    const p = await fetchUserProfile(d as string);
    articleProfileMap.set(d as string, p);
  }));

  const articles = rows.map((r: any) => {
    const p = articleProfileMap.get(r.author_did) || { displayName: r.author_did, avatar: '', handle: r.author_did };
    return {
      uri: r.uri,
      title: r.title || 'Untitled',
      description: r.description || null,
      publishedAt: r.published_at?.toISOString() ?? null,
      authorDid: r.author_did,
      authorHandle: p.handle,
      authorAvatar: p.avatar,
      authorName: p.displayName,
      wordCount: r.word_count || 0,
      rkey: r.uri.split('/').pop() || '',
    };
  });

  const publication = {
    uri: pubUri,
    title: pubRecord.name || pubRecord.title || 'Untitled Publication',
    description: pubRecord.description || '',
    url: pubRecord.url || null,
    authorDid: did,
    authorHandle: authorProfile.handle,
    authorAvatar: authorProfile.avatar,
    authorName: authorProfile.displayName,
    createdAt: pubRecord.createdAt || null,
    collection: pubCollection,
    rkey,
  };

  return c.html((
    <Layout title={`${publication.title} - ${config.LONGFORM_DOMAIN}`} profile={sessionProfile}>
      {PublicationPage({ publication, articles, domain: config.LONGFORM_DOMAIN })}
    </Layout>
  ) as unknown as string);
});

app.get('/publication/:did/:rkey/source', async (c) => {
  const did = c.req.param('did');
  const rkey = c.req.param('rkey');

  const collections = ['site.standard.publication', 'pub.leaflet.publication'];
  for (const col of collections) {
    try {
      const pdsEndpoint = await resolvePds(did);
      if (!pdsEndpoint) continue;
      const agent = new BskyAgent({ service: pdsEndpoint });
      const res = await agent.com.atproto.repo.getRecord({ repo: did, collection: col, rkey });
      if (res.data?.value) {
        return c.html(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <title>Publication Source — ${(res.data.value as any).title || rkey}</title>
              <style>
                body { background: #1a1a1a; color: #e5e5e5; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; padding: 2rem; line-height: 1.5; margin: 0; }
                pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 14px; }
                .key { color: #81a1c1; }
                .string { color: #a3be8c; }
                .number { color: #b48ead; }
                .boolean { color: #d08770; }
                .null { color: #bf616a; }
                .back { display: inline-block; margin-bottom: 1.5rem; color: #81a1c1; text-decoration: none; font-size: 14px; }
                .back:hover { text-decoration: underline; }
              </style>
            </head>
            <body>
              <a href="/publication/${did}/${rkey}" class="back">← Back to publication</a>
              <pre>${JSON.stringify(res.data.value, null, 2)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
                  let cls = 'number';
                  if (/^"/.test(match)) {
                    if (/:$/.test(match)) cls = 'key';
                    else cls = 'string';
                  } else if (/true|false/.test(match)) cls = 'boolean';
                  else if (/null/.test(match)) cls = 'null';
                  return '<span class="' + cls + '">' + match + '</span>';
                })}</pre>
            </body>
          </html>
        `);
      }
    } catch (e) { continue; }
  }
  return c.json({ error: 'Publication not found' }, 404);
});

app.get('/profile/:identifier', async (c) => {
  const identifier = c.req.param('identifier');
  const sessionDid = await getSession(c);
  const sessionProfile = sessionDid ? await fetchUserProfile(sessionDid) : null;

  // Resolve identifier to DID — can be a handle or DID
  let did: string;
  let handle: string;
  if (identifier.startsWith('did:')) {
    did = identifier;
    handle = identifier;
  } else {
    const res = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${identifier}`);
    if (!res.ok) return c.text('User not found', 404);
    const data = await res.json() as any;
    did = data.did;
    handle = identifier;
  }

  // Fetch full profile from Bluesky
  let authorData: ProfileData = {
    did,
    handle,
    displayName: handle,
    avatar: '',
    description: '',
    followersCount: 0,
    followsCount: 0,
  };
  try {
    const profileRes = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`).then(r => r.json()) as any;
    if (profileRes && !profileRes.error) {
      authorData = {
        did,
        handle: profileRes.handle || handle,
        displayName: profileRes.displayName || profileRes.handle || handle,
        avatar: profileRes.avatar || '',
        description: profileRes.description || '',
        followersCount: profileRes.followersCount || 0,
        followsCount: profileRes.followsCount || 0,
      };
    }
  } catch (e) {}

  // Fetch their articles
  const { rows } = await db.query(
    `SELECT s.uri, s.author_did, s.title, s.description, s.published_at, COALESCE(p.url, s.site) as site, s.path, s.word_count,
       split_part(s.uri, '/', 4) AS collection,
       CASE WHEN s.uri LIKE '%/site.standard.document/%' OR s.uri LIKE '%/pub.leaflet.document/%'
         THEN jsonb_path_query_first(s.raw_record, '$.content.pages[0].blocks[*].block ? (@."$type" == "pub.leaflet.blocks.image").image.ref."$link"') #>> '{}'
         ELSE NULL
       END AS image_cid,
       CASE WHEN s.raw_record->>'site' LIKE 'at://%site.standard.publication%'
         THEN s.raw_record->>'site'
         ELSE NULL
       END AS publication_uri
     FROM site_standard_articles s
     LEFT JOIN site_publications p ON p.uri = s.raw_record->>'site'
     WHERE s.author_did = $1
     ORDER BY s.published_at DESC`,
    [did]
  );

  const stories: LongformStory[] = rows.map((r: any) => {
    const rkey = r.uri.split('/').pop();
    const collection = r.collection;
    let readUrl: string | null = null;
    return {
      uri: r.uri,
      authorDid: r.author_did,
      authorHandle: authorData.handle,
      authorAvatar: authorData.avatar,
      authorName: authorData.displayName,
      title: r.title,
      description: r.description,
      publishedAt: r.published_at?.toISOString() ?? null,
      site: r.site,
      path: r.path,
      wordCount: r.word_count || 0,
      imageUrl: r.image_cid ? `/blob/${r.author_did}/${r.image_cid}` : null,
      externalUrl: readUrl,
      publicationUri: r.publication_uri || null,
    };
  });

  return c.html((<ProfilePage author={authorData} stories={stories} sessionProfile={sessionProfile} domain={config.LONGFORM_DOMAIN} />) as unknown as string);
});

app.get('/new', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.redirect('/');
  const rkey = Math.random().toString(36).substring(2, 15);
  const docId = "at://" + sessionDid + "/site.standard.document/" + rkey;
  await db.query('INSERT INTO longform_drafts (document_name, owner_did, title) VALUES ($1, $2, $3)', [docId, sessionDid, 'Untitled']);
  return c.redirect('/?doc=' + encodeURIComponent(docId));
});

app.get('/posts', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.redirect('/');
  
  try {
    const profile = await fetchUserProfile(sessionDid);

    // Fetch drafts from DB
    const { rows: drafts } = await db.query(
      'SELECT document_name, title, published_uri, created_at, updated_at FROM longform_drafts WHERE owner_did = $1 ORDER BY updated_at DESC',
      [sessionDid]
    );

    // Fetch published posts from PDS
    const oauthSession = await restoreSession(c, sessionDid);
    if (!oauthSession) return c.redirect('/login');
    const agent = new Agent(oauthSession);
    const pdsRes = await agent.com.atproto.repo.listRecords({
      repo: sessionDid,
      collection: 'site.standard.document',
      limit: 100
    });

    // Build a set of published document names (at:// URIs) from drafts table
    const publishedDraftNames = new Set(drafts.filter((d: any) => d.published_uri).map((d: any) => d.document_name));

    // Combine: drafts (unpublished) + published posts from PDS
    const items: any[] = [];

    // Add unpublished drafts
    for (const draft of drafts) {
      if (!draft.published_uri) {
        const parts = draft.document_name.split('/');
        items.push({
          documentName: draft.document_name,
          title: draft.title || 'Untitled',
          status: 'draft',
          date: new Date(draft.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          rkey: parts[parts.length - 1],
          did: sessionDid,
          sortDate: new Date(draft.updated_at),
        });
      }
    }

    // Add published posts from PDS
    for (const record of pdsRes.data.records as any[]) {
      const rkey = record.uri.split('/').pop();
      items.push({
        documentName: record.uri,
        title: record.value.title || 'Untitled',
        status: 'published',
        date: new Date(record.value.publishedAt || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        rkey,
        did: sessionDid,
        sortDate: new Date(record.value.publishedAt || Date.now()),
      });
    }

    // Sort by most recent first
    items.sort((a: any, b: any) => b.sortDate.getTime() - a.sortDate.getTime());

    // Fetch shared-with-me docs
    const { rows: sharedRows } = await db.query(
      `SELECT d.document_name, d.title, d.updated_at, a.permission, d.owner_did
       FROM longform_drafts d
       JOIN longform_yjs_acl a ON d.document_name = a.document_name
       WHERE a.did = $1 AND a.did != '*' AND d.owner_did != $1
       ORDER BY d.updated_at DESC`,
      [sessionDid]
    );

    const sharedItems = [];
    for (const row of sharedRows) {
      const ownerProfile = await fetchUserProfile(row.owner_did);
      sharedItems.push({
        documentName: row.document_name,
        title: row.title || 'Untitled',
        permission: row.permission,
        ownerHandle: ownerProfile.handle,
        date: new Date(row.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      });
    }

    return c.html((
      <Layout title={`My Work - ${config.LONGFORM_DOMAIN}`} profile={profile}>
        {PostsPage(items, sharedItems, sessionDid)}
      </Layout>
    ) as unknown as string);
  } catch (err: any) {
    logger.error({ err }, 'Failed to fetch posts for dashboard');
    return c.html((<Layout title="Error"><h1>Error loading posts</h1><p>{err.message}</p></Layout>) as unknown as string);
  }
});

app.get('/post/:did/:rkey', async (c) => {
  const did = c.req.param('did');
  const rkey = c.req.param('rkey');
  
  try {
    const sessionDid = await getSession(c);
    
    // Cache-first: try Redis, then PDS
    const result = await getCachedRecordMulti(
      did,
      ['site.standard.document', 'pub.leaflet.document', 'com.whtwnd.blog.entry'],
      rkey
    );
    if (!result) {
      return c.html((<Layout title="Post Not Found"><h1>Post Not Found</h1><p>Could not find this article.</p></Layout>) as unknown as string, 404);
    }
    
    // Fetch author profile (cached)
    const authorProfile = await getCachedProfile(did);
    const sessionProfile = sessionDid ? await getCachedProfile(sessionDid) : undefined;
    
    const doc = result.record as any;
    doc.rkey = rkey;

    if (doc.site && doc.site.startsWith('at://')) {
      try {
        const { rows } = await db.query('SELECT url, raw_record FROM site_publications WHERE uri = $1', [doc.site]);
        if (rows.length > 0) {
          doc.publicationUrl = rows[0].url;
          doc.publicationTitle = rows[0].raw_record?.name || rows[0].raw_record?.title || null;
        } else {
          // Fallback: fetch from PDS on-demand if not in DB
          const [siteDid, , siteRkey] = doc.site.replace('at://', '').split('/');
          const pdsEndpoint = await resolvePds(siteDid);
          if (pdsEndpoint) {
            const agent = new BskyAgent({ service: pdsEndpoint });
            const pdsRes = await agent.com.atproto.repo.getRecord({
              repo: siteDid,
              collection: 'site.standard.publication',
              rkey: siteRkey
            });
            const pubUrl = (pdsRes.data.value as any).url;
            if (pubUrl && typeof pubUrl === 'string') {
              doc.publicationUrl = pubUrl;
              doc.publicationTitle = (pdsRes.data.value as any).name || (pdsRes.data.value as any).title || null;
              await db.query(
                'INSERT INTO site_publications (uri, url, raw_record) VALUES ($1, $2, $3) ON CONFLICT (uri) DO UPDATE SET url = $2, raw_record = $3',
                [doc.site, pubUrl, pdsRes.data.value]
              );
            }
          }
        }
      } catch (err) {
        logger.warn({ err, uri: doc.site }, 'Failed to lookup or fetch publication details');
      }
    }

    // Check if unsupported format for logging
    let hasBlocks = false;
    if (doc.content?.pages && doc.content.pages.length > 0) {
      hasBlocks = (doc.content.pages[0].blocks || []).length > 0;
    } else if (doc.pages && doc.pages.length > 0) {
      hasBlocks = (doc.pages[0].blocks || []).length > 0;
    }
    const isMarkdownString = typeof doc.content === 'string';

    if (!hasBlocks && !isMarkdownString && !doc.textContent) {
      logger.warn({ did, rkey }, 'Encountered unsupported document format in native reader');
    }
    
    // Extract description from first text block if no description is provided
    let excerpt = '';
    if (doc.content?.pages?.[0]?.blocks) {
      const textBlock = doc.content.pages[0].blocks.find((b: any) => b.block?.$type === 'pub.leaflet.blocks.text');
      if (textBlock && textBlock.block?.plaintext) {
        excerpt = textBlock.block.plaintext.substring(0, 160).trim() + '...';
      }
    }
    
    const og = {
      title: doc.title,
      description: excerpt || 'Read this article on Longform',
      url: `https://${config.LONGFORM_DOMAIN}/post/${did}/${rkey}`,
    };
    
    const currentActualUri = `at://${did}/${result.collection}/${rkey}`;
    const currentKey = `${did}/${rkey}`;
    let relatedArticles: any[] = [];
    try {
      const hits = await getRelatedArticles(currentActualUri, 10);
      const seenKeys = new Set<string>();
      seenKeys.add(currentKey); // exclude the current article itself
      
      for (const hit of hits) {
        const source = hit._source;
        if (!source || !source.uri) continue;
        
        const key = `${source.did}/${source.uri.split('/').pop()}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        
        try {
          source.authorProfile = await fetchUserProfile(source.did);
        } catch (e) {
          source.authorProfile = null;
        }
        
        relatedArticles.push(source);
        if (relatedArticles.length >= 3) break;
      }
    } catch (e) {
      logger.warn({ err: e, uri: currentActualUri }, 'Failed to fetch related articles');
    }

    return c.html((
      <Layout title={`${doc.title} - ${config.LONGFORM_DOMAIN}`} profile={sessionProfile} og={og}>
        {ReaderPage(doc, did, authorProfile, relatedArticles, sessionDid)}
      </Layout>
    ) as unknown as string);
  } catch (err: any) {
    logger.error({ err, did, rkey }, 'Failed to load post for reader');
    return c.html((
      <Layout title="Post Not Found">
        <h1>Post Error</h1>
        <p>Failed to load the post. Error details:</p>
        <pre style="background: #1a1a1a; color: #ff5555; padding: 1rem; border-radius: 8px; overflow-x: auto;"><code>${err.message}\n\n${err.stack}</code></pre>
      </Layout>
    ) as unknown as string);
  }
});

app.get('/post/:did/:rkey/source', async (c) => {
  const did = c.req.param('did');
  const rkey = c.req.param('rkey');
  
  try {
    const result = await getCachedRecordMulti(
      did,
      ['site.standard.document', 'pub.leaflet.document', 'com.whtwnd.blog.entry', 'site.standard.publication'],
      rkey
    );
    if (!result) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Raw Record Source</title>
          <style>
            body { background: #1a1a1a; color: #e5e5e5; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; padding: 2rem; line-height: 1.5; margin: 0; }
            pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 14px; }
            .key { color: #81a1c1; }
            .string { color: #a3be8c; }
            .number { color: #b48ead; }
            .boolean { color: #d08770; }
            .null { color: #bf616a; }
          </style>
        </head>
        <body>
          <pre>${JSON.stringify(result.record, null, 2)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g, function (match) {
              let cls = 'number';
              if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                  cls = 'key';
                } else {
                  cls = 'string';
                }
              } else if (/true|false/.test(match)) {
                cls = 'boolean';
              } else if (/null/.test(match)) {
                cls = 'null';
              }
              return '<span class="' + cls + '">' + match + '</span>';
            })}</pre>
        </body>
      </html>
    `);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/blob/:did/:cid', async (c) => {
  const did = c.req.param('did');
  const cid = c.req.param('cid');
  
  try {
    // Resolve the PDS and fetch the blob directly via HTTP
    const pdsUrl = await resolvePds(did);
    const blobUrl = `${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
    const res = await fetch(blobUrl);
    
    if (!res.ok) {
      logger.warn({ did, cid, status: res.status }, 'Blob fetch from PDS failed');
      return c.text('Image not found', 404);
    }
    
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const body = await res.arrayBuffer();
    
    return c.body(body as any, 200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable'
    });
  } catch (err: any) {
    logger.error({ err, did, cid }, 'Failed to fetch blob from PDS');
    return c.text('Image not found', 404);
  }
});

// --- Publication subscription (follow) API ---

app.get('/api/subscription-status', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.json({ subscribed: false, rkey: null });
  const pubUri = c.req.query('publication');
  if (!pubUri) return c.json({ subscribed: false, rkey: null });

  try {
    const oauthSession = await restoreSession(c, sessionDid);
    if (!oauthSession) return c.json({ subscribed: false, rkey: null, session_expired: true });
    const agent = new Agent(oauthSession);
    const res = await agent.com.atproto.repo.listRecords({
      repo: sessionDid,
      collection: 'site.standard.graph.subscription',
      limit: 100,
    });
    const match = (res.data.records || []).find((r: any) => r.value?.publication === pubUri);
    if (match) {
      const rkey = match.uri.split('/').pop();
      return c.json({ subscribed: true, rkey });
    }
    return c.json({ subscribed: false, rkey: null });
  } catch (err: any) {
    logger.error({ err }, 'Failed to check subscription status');
    return c.json({ subscribed: false, rkey: null });
  }
});

app.post('/api/subscribe', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.json({ error: 'Not authenticated' }, 401);

  const body = await c.req.json();
  const pubUri = body.publication;
  if (!pubUri || typeof pubUri !== 'string' || !pubUri.startsWith('at://')) {
    return c.json({ error: 'Invalid publication URI' }, 400);
  }

  try {
    const oauthSession = await restoreSession(c, sessionDid);
    if (!oauthSession) return c.json({ error: 'Session expired, please sign in again' }, 401);
    const agent = new Agent(oauthSession);

    const res = await agent.com.atproto.repo.createRecord({
      repo: sessionDid,
      collection: 'site.standard.graph.subscription',
      record: {
        $type: 'site.standard.graph.subscription',
        publication: pubUri,
        createdAt: new Date().toISOString(),
      },
    });

    const rkey = res.data.uri.split('/').pop();
    logger.info({ did: sessionDid, publication: pubUri, rkey }, 'User subscribed to publication');
    return c.json({ ok: true, rkey });
  } catch (err: any) {
    logger.error({ err: err.message || err, pubUri }, 'Failed to create subscription');
    return c.json({ error: err.message || 'Failed to subscribe' }, 500);
  }
});

app.post('/api/unsubscribe', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.json({ error: 'Not authenticated' }, 401);

  const body = await c.req.json();
  const rkey = body.rkey;
  if (!rkey) return c.json({ error: 'Missing rkey' }, 400);

  try {
    const oauthSession = await restoreSession(c, sessionDid);
    if (!oauthSession) return c.json({ error: 'Session expired, please sign in again' }, 401);
    const agent = new Agent(oauthSession);

    await agent.com.atproto.repo.deleteRecord({
      repo: sessionDid,
      collection: 'site.standard.graph.subscription',
      rkey,
    });

    logger.info({ did: sessionDid, rkey }, 'User unsubscribed from publication');
    return c.json({ ok: true });
  } catch (err: any) {
    logger.error({ err, rkey }, 'Failed to delete subscription');
    return c.json({ error: 'Failed to unsubscribe' }, 500);
  }
});

app.get('/api/my-permission', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.json({ permission: null });
  const docId = c.req.query('docId');
  if (!docId) return c.json({ error: 'Missing docId' }, 400);
  // Owner always has write
  if (docId.startsWith("at://" + sessionDid + "/")) return c.json({ permission: 'owner' });
  // Check specific ACL, then wildcard
  const { rows } = await db.query(
    'SELECT permission FROM longform_yjs_acl WHERE document_name = $1 AND did IN ($2, $3) ORDER BY CASE WHEN did = $2 THEN 0 ELSE 1 END LIMIT 1',
    [docId, sessionDid, '*']
  );
  return c.json({ permission: rows.length > 0 ? rows[0].permission : null });
});

app.post('/api/drafts', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const rkey = Math.random().toString(36).substring(2, 15);
    const docId = `at://${sessionDid}/site.standard.document/${rkey}`;
    
    await db.query(
      'INSERT INTO longform_drafts (document_name, owner_did, title) VALUES ($1, $2, $3)',
      [docId, sessionDid, 'Untitled']
    );

    return c.json({ docId });
  } catch (err: any) {
    logger.error({ err }, 'Failed to create draft');
    return c.json({ error: err.message || 'Internal server error' }, 500);
  }
});

app.delete('/api/drafts', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const { docId, rkey } = await c.req.json();
    if (!docId && !rkey) return c.json({ error: 'Missing docId or rkey' }, 400);

    // If it is a published post (has rkey but no draft entry), delete from PDS
    if (rkey) {
      try {
        const oauthSession = await restoreSession(c, sessionDid);
        if (!oauthSession) return c.json({ error: 'Session expired' }, 401);
        const agent = new Agent(oauthSession);
        await agent.com.atproto.repo.deleteRecord({
          repo: sessionDid,
          collection: 'site.standard.document',
          rkey: rkey
        });
      } catch (pdsErr: any) {
        logger.warn({ err: pdsErr, rkey }, 'Failed to delete PDS record (may not exist)');
      }
    }

    // Clean up local data if docId provided
    if (docId) {
      if (!docId.startsWith("at://" + sessionDid + "/")) return c.json({ error: 'Unauthorized' }, 403);
      await db.query('DELETE FROM longform_yjs_acl WHERE document_name = $1', [docId]);
      await db.query('DELETE FROM longform_yjs_documents WHERE name = $1', [docId]);
      await db.query('DELETE FROM longform_drafts WHERE document_name = $1 AND owner_did = $2', [docId, sessionDid]);
    }

    return c.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, 'Failed to delete post');
    return c.json({ error: err.message || 'Internal server error' }, 500);
  }
});


app.post('/api/publish', async (c) => {
   const sessionDid = await getSession(c);
   if (!sessionDid) return c.json({ error: 'Unauthorized' }, 401);
   
   try {
     const body = await c.req.json();
     const oauthSession = await restoreSession(c, sessionDid);
     if (!oauthSession) return c.json({ error: 'Session expired' }, 401);
     const agent = new Agent(oauthSession);
     
      // Extract title from first heading in the document, fallback to body.title
      let title = body.title || 'Untitled Draft';
      const documentJson = body.document;
      if (documentJson && documentJson.content) {
        for (const node of documentJson.content) {
          if (node.type === 'heading' && node.content) {
            const headingText = node.content.map((s: any) => s.text || '').join('').trim();
            if (headingText) { title = headingText; break; }
          }
        }
      }
      
      // Use rkey from docId if this is an existing draft, otherwise generate new
      const docId = body.docId;
      let rkey: string;
      if (docId && docId.startsWith('at://')) {
        rkey = docId.split('/').pop()!;
      } else {
        rkey = Math.random().toString(36).substring(2, 15);
      }

     // Ensure the user has a default publication record on their PDS
     let publicationUri: string | undefined;
     try {
       // Try to fetch existing default publication
       const pubRes = await agent.com.atproto.repo.getRecord({
         repo: sessionDid,
         collection: 'site.standard.publication',
         rkey: 'self',
       }).catch(() => null);

       if (pubRes?.data?.uri) {
         publicationUri = pubRes.data.uri;
       } else {
         // Fetch profile for display name
         let pubTitle = 'My Blog';
         try {
           const publicAgent = new BskyAgent({ service: 'https://public.api.bsky.app' });
           const profile = await publicAgent.getProfile({ actor: sessionDid });
           if (profile.data.displayName) {
             pubTitle = `${profile.data.displayName}'s Blog`;
           }
         } catch (e) { /* fallback to generic title */ }

         // Create default publication
         const createRes = await agent.com.atproto.repo.putRecord({
           repo: sessionDid,
           collection: 'site.standard.publication',
           rkey: 'self',
           record: {
             $type: 'site.standard.publication',
             name: pubTitle,
             description: '',
             url: `https://${config.LONGFORM_DOMAIN || 'longform.social'}`,
             createdAt: new Date().toISOString(),
             preferences: {
               showComments: true,
               showMentions: true,
               showPrevNext: true,
               showInDiscover: true,
               showRecommends: true,
             },
           },
         });
         publicationUri = createRes.data.uri;
         logger.info({ did: sessionDid, uri: publicationUri }, 'Auto-created default publication record');
       }
     } catch (err: any) {
       logger.warn({ err, did: sessionDid }, 'Failed to ensure publication record, falling back to HTTPS site');
     }

     const leafletDoc = await serializeTiptapToLeaflet(documentJson, title, sessionDid, agent, rkey, publicationUri);

     // Check if this is a re-publish (update) or first publish (create)
     let isRepublish = false;
     if (docId && docId.startsWith('at://')) {
       // Direct edit from published post — always an update
       isRepublish = true;
     } else if (docId) {
       const { rows: draftRows } = await db.query(
         'SELECT published_uri FROM longform_drafts WHERE document_name = $1 AND owner_did = $2',
         [docId, sessionDid]
       );
       if (draftRows.length > 0 && draftRows[0].published_uri) {
         isRepublish = true;
       }
     }

     let res;
     if (isRepublish) {
       // Update existing record on PDS
       res = await agent.com.atproto.repo.putRecord({
         repo: sessionDid,
         collection: 'site.standard.document',
         rkey: rkey,
         record: leafletDoc
       });
       logger.info({ event: 'longform_republish', did: sessionDid, rkey }, 'User re-published a document');
     } else {
       // Create new record on PDS
       res = await agent.com.atproto.repo.createRecord({
         repo: sessionDid,
         collection: 'site.standard.document',
         rkey: rkey,
         record: leafletDoc
       });
     }
     
     // Retrieve user handle for logging and announcement using public AppView
     let authorHandle = sessionDid;
     try {
       const publicAgent = new BskyAgent({ service: 'https://public.api.bsky.app' });
       const profile = await publicAgent.getProfile({ actor: sessionDid });
       if (profile.data.handle) authorHandle = profile.data.handle;
     } catch (e) {
       // fallback to did
     }
     
     // Structured telemetry log
     logger.info({ event: 'longform_publish', did: sessionDid, handle: authorHandle, uri: res.data.uri }, 'User successfully published a document');
     
     // Calculate word count to prevent spamming tests
     let textContent = '';
     if (documentJson && documentJson.content) {
       const extractText = (node: any) => {
         if (node.type === 'text') textContent += (node.text || '') + ' ';
         if (node.content) node.content.forEach(extractText);
       };
       extractText(documentJson);
     }
     const wordCount = textContent.trim().split(/\s+/).length;

     if (wordCount >= 100) {
       // Announce the publication via Bot asynchronously (don't await)
       announcePublication(authorHandle, title, res.data.uri).catch(e => {
         logger.error({ err: e }, 'Failed asynchronous bot publication announcement');
       });
     } else {
       logger.info({ uri: res.data.uri, wordCount }, 'Skipping bot announcement for short post');
     }
     
     // Mark draft as published
      if (docId) {
        await db.query(
          'UPDATE longform_drafts SET published_uri = $1, title = $2, updated_at = NOW() WHERE document_name = $3',
          [res.data.uri, title, docId]
        );
      }
      
      return c.json({ success: true, uri: res.data.uri, cid: res.data.cid });
   } catch (err: any) {
     logger.error({ err }, 'Failed to publish Leaflet document from Longform');
     return c.json({ error: err.message }, 500);
   }
});

app.get('/api/comments', async (c) => {
  const url = c.req.query('url');
  const originalUrl = c.req.query('originalUrl');
  if (!url) return c.json({ error: 'Missing url parameter' }, 400);
  
  try {
    const agent = await getLongformBot();
    if (!agent) return c.json({ posts: [] });
    
    const promises = [agent.app.bsky.feed.searchPosts({ q: url, limit: 15 })];
    if (originalUrl) {
      promises.push(agent.app.bsky.feed.searchPosts({ q: originalUrl, limit: 15 }));
    }
    
    const results = await Promise.all(promises);
    
    const postsMap = new Map();
    for (const res of results) {
      for (const post of res.data.posts) {
        postsMap.set(post.uri, post);
      }
    }
    
    const sortedPosts = Array.from(postsMap.values())
      .sort((a: any, b: any) => new Date(b.indexedAt).getTime() - new Date(a.indexedAt).getTime())
      .slice(0, 15);
      
    return c.json({ posts: sortedPosts });
  } catch (err: any) {
    logger.error({ err, url }, 'Failed to fetch comments');
    return c.json({ error: 'Search failed' }, 500);
  }
});

app.post('/api/like', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.json({ error: 'Unauthorized' }, 401);
  
  try {
    let { rkey, authorDid, uri, cid } = await c.req.json();
    const oauthSession = await restoreSession(c, sessionDid);
    if (!oauthSession) return c.json({ error: 'Session expired' }, 401);
    const agent = new Agent(oauthSession);
    
    if (!uri || !cid) {
      uri = `at://${authorDid}/site.standard.document/${rkey}`;
      const pdsUrl = await resolvePds(authorDid);
      const fetchAgent = new BskyAgent({ service: pdsUrl });
      const record = await fetchAgent.com.atproto.repo.getRecord({
        repo: authorDid,
        collection: 'site.standard.document',
        rkey
      });
      cid = record.data.cid;
    }
    
    const res = await agent.com.atproto.repo.createRecord({
      repo: sessionDid,
      collection: 'app.bsky.feed.like',
      record: {
        subject: { uri, cid },
        createdAt: new Date().toISOString()
      }
    });
    
    // Track locally (source of truth for stats)
    await db.query(
      `INSERT INTO article_interactions (article_uri, actor_did, interaction_type, record_uri)
       VALUES ($1, $2, 'like', $3) ON CONFLICT (article_uri, actor_did, interaction_type) DO NOTHING`,
      [uri, sessionDid, res.data.uri]
    );
    
    return c.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, 'Failed to like article');
    return c.json({ error: err.message }, 500);
  }
});

app.post('/api/repost', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.json({ error: 'Unauthorized' }, 401);
  
  try {
    let { rkey, authorDid, uri, cid } = await c.req.json();
    const oauthSession = await restoreSession(c, sessionDid);
    if (!oauthSession) return c.json({ error: 'Session expired' }, 401);
    const agent = new Agent(oauthSession);
    
    if (!uri || !cid) {
      uri = `at://${authorDid}/site.standard.document/${rkey}`;
      const pdsUrl = await resolvePds(authorDid);
      const fetchAgent = new BskyAgent({ service: pdsUrl });
      const record = await fetchAgent.com.atproto.repo.getRecord({
        repo: authorDid,
        collection: 'site.standard.document',
        rkey
      });
      cid = record.data.cid;
    }
    
    const res = await agent.com.atproto.repo.createRecord({
      repo: sessionDid,
      collection: 'app.bsky.feed.repost',
      record: {
        subject: { uri, cid },
        createdAt: new Date().toISOString()
      }
    });
    
    // Track locally
    await db.query(
      `INSERT INTO article_interactions (article_uri, actor_did, interaction_type, record_uri)
       VALUES ($1, $2, 'repost', $3) ON CONFLICT (article_uri, actor_did, interaction_type) DO NOTHING`,
      [uri, sessionDid, res.data.uri]
    );
    
    return c.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, 'Failed to repost article');
    return c.json({ error: err.message }, 500);
  }
});

app.get('/api/stats', async (c) => {
  const { authorDid, rkey } = c.req.query();
  if (!authorDid || !rkey) return c.json({ error: 'Missing parameters' }, 400);
  
  const sessionDid = await getSession(c);
  // Default to standard site document, but since WhiteWind uses a different collection,
  // we may need to support it if it arises. For now, rely on standard format or allow
  // the client to pass the full URI in the future.
  const articleUri = `at://${authorDid}/site.standard.document/${rkey}`;
  
  try {
    const { rows } = await db.query(
      `SELECT interaction_type, count(*)::int AS count,
              bool_or(actor_did = $2) AS by_session
       FROM article_interactions
       WHERE article_uri = $1
       GROUP BY interaction_type`,
      [articleUri, sessionDid || '']
    );
    
    let likes = 0, reposts = 0, liked = false, reposted = false;
    for (const row of rows) {
      if (row.interaction_type === 'like') { likes = row.count; liked = row.by_session; }
      if (row.interaction_type === 'repost') { reposts = row.count; reposted = row.by_session; }
    }
    
    return c.json({
      likes,
      likesDisplay: likes.toString(),
      reposts,
      repostsDisplay: reposts.toString(),
      liked,
      reposted
    });
  } catch (err: any) {
    logger.error({ err }, 'Failed to get stats');
    return c.json({ likes: 0, reposts: 0, liked: false, reposted: false });
  }
});

app.get('/api/acl', async (c) => {
  const sessionDid = await getSession(c);
  const docId = c.req.query('docId');
  if (!sessionDid || !docId) return c.json({ error: 'Missing params' }, 400);
  if (!docId.startsWith(`at://${sessionDid}/`)) return c.json({ error: 'Unauthorized' }, 403);
  
  const { rows } = await db.query('SELECT did, permission FROM longform_yjs_acl WHERE document_name = $1', [docId]);
  
  const acls = await Promise.all(rows.map(async r => {
    const profile = await fetchUserProfile(r.did);
    return { did: r.did, permission: r.permission, handle: profile.handle };
  }));
  return c.json({ acls });
});

app.post('/api/acl', async (c) => {
  try {
    const sessionDid = await getSession(c);
    const { docId, didOrHandle, permission } = await c.req.json();
    if (!sessionDid || !docId || !didOrHandle) return c.json({ error: 'Missing params' }, 400);
    if (!docId.startsWith(`at://${sessionDid}/`)) return c.json({ error: 'Unauthorized' }, 403);

    let targetDid = didOrHandle.trim();
    if (targetDid !== '*' && !targetDid.startsWith('did:')) {
      targetDid = targetDid.replace(/^@/, '');
      const res = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(targetDid)}`);
      if (!res.ok) return c.json({ error: 'Handle not found' }, 404);
      const data = await res.json();
      targetDid = data.did;
    }

    await db.query(
      `INSERT INTO longform_yjs_acl (document_name, did, permission) VALUES ($1, $2, $3)
       ON CONFLICT (document_name, did) DO UPDATE SET permission = $3`,
      [docId, targetDid, permission || 'write']
    );
    const profile = await fetchUserProfile(targetDid);
    return c.json({ success: true, did: targetDid, handle: profile.handle, permission: permission || 'write' });
  } catch (err: any) {
    logger.error({ err }, 'Failed to add collaborator');
    return c.json({ error: err.message || 'Internal server error' }, 500);
  }
});

app.delete('/api/acl', async (c) => {
  const sessionDid = await getSession(c);
  const { docId, did } = await c.req.json();
  if (!sessionDid || !docId || !did) return c.json({ error: 'Missing params' }, 400);
  if (!docId.startsWith(`at://${sessionDid}/`)) return c.json({ error: 'Unauthorized' }, 403);

  await db.query('DELETE FROM longform_yjs_acl WHERE document_name = $1 AND did = $2', [docId, did]);
  return c.json({ success: true });
});

const collabServer = HocuspocusServer.configure({
  name: 'longform-collab',
  extensions: [hocuspocusDb],
  async onAuthenticate(data) {
    const cookieHeader = data.request.headers.cookie || '';
    const match = cookieHeader.match(/lf_session=([^;]+)/);
    const did = match ? decodeURIComponent(match[1]) : 'anonymous';

    const docName = data.documentName;
    if (docName.startsWith('at://')) {
      const ownerDid = docName.split('/')[2];
      if (did === ownerDid) return { user: { id: did, permission: 'write' } };
      
      // Check specific DID permission first, then wildcard '*' (public access)
      const { rows } = await db.query(
        'SELECT permission FROM longform_yjs_acl WHERE document_name = $1 AND did IN ($2, $3) ORDER BY CASE WHEN did = $2 THEN 0 ELSE 1 END LIMIT 1',
        [docName, did, '*']
      );
      if (rows.length === 0) {
        throw new Error('Access denied: You are not authorized to view this document');
      }
      
      if (rows[0].permission === 'read') {
        data.connection.readOnly = true;
      }
      
      return { user: { id: did, permission: rows[0].permission } };
    }

    return { user: { id: did } };
  }
});

const wss = new WebSocketServer({ noServer: true });

// Bare rkey redirect — handles old URLs like /j6o5y1yxcm
app.get('/:rkey', async (c) => {
  const rkey = c.req.param('rkey');
  // Only handle strings that look like rkeys (alphanumeric, no dots/slashes)
  if (!/^[a-zA-Z0-9_~:-]{3,50}$/.test(rkey)) {
    return c.html((<NotFoundPage />) as unknown as string, 404);
  }

  try {
    // Look up article by rkey suffix in the URI
    const { rows } = await db.query(
      `SELECT uri, author_did FROM site_standard_articles WHERE uri LIKE $1 LIMIT 1`,
      [`%/${rkey}`]
    );
    if (rows.length > 0) {
      return c.redirect(`/post/${rows[0].author_did}/${rkey}`, 301);
    }
  } catch (err) {
    logger.warn({ err, rkey }, 'Failed to look up bare rkey redirect');
  }

  return c.html((<NotFoundPage />) as unknown as string, 404);
});

// Custom 404 page
app.notFound((c) => {
  return c.html((<NotFoundPage />) as unknown as string, 404);
});

// Startup hook
async function start() {
  await runMigrations();
  const server = serve({ fetch: app.fetch, port: config.LONGFORM_PORT }, (info) => {
    logger.info({ port: info.port, domain: config.LONGFORM_DOMAIN }, 'Longform service started');
  });
  
  server.on('upgrade', (request, socket, head) => {
    if (request.url === '/collab' || request.url?.startsWith('/collab/')) {
      // Pass the upgrade to ws server
      wss.handleUpgrade(request, socket, head, (ws) => {
        collabServer.handleConnection(ws, request);
      });
    }
  });
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start longform web server');
  process.exit(1);
});

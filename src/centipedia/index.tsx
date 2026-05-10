import { Hono } from 'hono';
import { html } from 'hono/html';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { EditorPage } from './views/editor.js';
import { PostsPage } from './views/posts.js';
import { ArticleReaderPage, extractFirstImageUrl, extractExcerpt } from './views/reader.js';
import { Layout } from './views/layout.js';
import { HomePage } from './views/home.js';
import type { CentipediaCitation } from './views/home.js';
import { TopicsPage } from './views/topics.js';
import { SubmitPage } from './views/submit.js';
import { MyCitationsPage } from './views/my-citations.js';
import { ProfilePage } from './views/profile.js';
import { SearchPage } from './views/search.js';
import { TopicPage } from './views/topic.js';
import { NotFoundPage } from './views/notfound.js';
import type { ProfileData, ProfileCitation, TrustStats, ContributedArticle } from './views/profile.js';
import type { SearchResult } from './views/search.js';
import { authRouter, getSession, getCentipediaAuthClient } from './routes/auth.js';
import { Agent, BskyAgent } from '@atproto/api';
import { serializeTiptapToLeaflet } from './lib/leafletExporter.js';
import { resolvePds } from '../lib/pds.js';
import { getCachedRecord, getCachedRecordMulti, getCachedListRecords, getCachedProfile, warmRecord, invalidateList } from '../lib/pdsCache.js';
import { announceArticle, getCentipediaBot } from './bot.js';
import { Server as HocuspocusServer } from '@hocuspocus/server';
import { hocuspocusDb } from './lib/hocuspocusDb.js';
import { WebSocketServer } from 'ws';
import { db } from '../db/client.js';

import { startResearchAgent } from './agents/research.js';

process.on('unhandledRejection', (err) => {
  logger.warn({ err }, 'Caught unhandled promise rejection in Longform (likely a background OAuth token getter)');
});

// ─── Rate limiting ───────────────────────────────────────────────────────────

const rateLimitStore = new Map<string, number[]>();

function rateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = rateLimitStore.get(key) || [];
  const valid = timestamps.filter(t => now - t < windowMs);
  if (valid.length >= maxRequests) return false;
  valid.push(now);
  rateLimitStore.set(key, valid);
  return true;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitStore) {
    const valid = timestamps.filter(t => now - t < 300_000);
    if (valid.length === 0) rateLimitStore.delete(key);
    else rateLimitStore.set(key, valid);
  }
}, 300_000);

const app = new Hono();

// Bot DID — single source of truth, falls back to config
const BOT_DID = config.CENTIPEDIA_BOT_DID || 'did:plc:srdudtvbpm5ck3i4mjdoasdy';

// Topic slug helpers
function slugifyTopic(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function resolveTopicSlug(slug: string): Promise<string | null> {
  // Try exact match first (already a real topic name)
  const { rows: exact } = await db.query(
    'SELECT DISTINCT topic FROM centipedia_citations WHERE topic = $1 LIMIT 1',
    [slug]
  );
  if (exact.length > 0) return exact[0].topic;

  // Try case-insensitive match (handles URL-encoded topic names)
  const { rows: icase } = await db.query(
    'SELECT DISTINCT topic FROM centipedia_citations WHERE lower(topic) = lower($1) LIMIT 1',
    [slug]
  );
  if (icase.length > 0) return icase[0].topic;

  // Try slug match — find topics whose slugified version matches
  const { rows: all } = await db.query(
    'SELECT DISTINCT topic FROM centipedia_citations WHERE topic IS NOT NULL'
  );
  for (const row of all) {
    if (slugifyTopic(row.topic) === slug) return row.topic;
  }
  return null;
}

// --- Health endpoint ---
app.get('/health', async (c) => {
  try {
    await db.query('SELECT 1');
    return c.json({ status: 'ok', service: 'centipedia', uptime: process.uptime() });
  } catch {
    return c.json({ status: 'error', service: 'centipedia', error: 'database unreachable' }, 503);
  }
});

// --- Global error handler ---
app.onError((err, c) => {
  logger.error({ err, path: c.req.path, method: c.req.method }, 'Unhandled request error');
  if (c.req.header('accept')?.includes('application/json')) {
    return c.json({ error: 'Internal server error' }, 500);
  }
  return c.html(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error — Centipedia</title>
    <style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f8f9fa;color:#1a1a1a}
    .err{text-align:center}.err h1{font-size:4rem;margin:0;opacity:0.2}.err p{color:#666;margin-top:1rem}.err a{color:#4f46e5;text-decoration:none}</style>
    </head><body><div class="err"><h1>500</h1><p>Something went wrong.</p><p><a href="/">← Back to Centipedia</a></p></div></body></html>`, 500);
});

app.notFound((c) => {
  if (c.req.header('accept')?.includes('application/json')) {
    return c.json({ error: 'Not found' }, 404);
  }
  return c.html(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not Found — Centipedia</title>
    <style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f8f9fa;color:#1a1a1a}
    .err{text-align:center}.err h1{font-size:4rem;margin:0;opacity:0.2}.err p{color:#666;margin-top:1rem}.err a{color:#4f46e5;text-decoration:none}</style>
    </head><body><div class="err"><h1>404</h1><p>This page doesn't exist.</p><p><a href="/">← Back to Centipedia</a></p></div></body></html>`, 404);
});

app.use('/logo.jpg', serveStatic({ root: './src/centipedia/public', path: 'logo.jpg' }));
app.use('/favicon.png', serveStatic({ root: './src/centipedia/public', path: 'favicon.jpeg' }));

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
    const client = await getCentipediaAuthClient();
    return await client.restore(sessionDid);
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('deleted') || msg.includes('revoked') || msg.includes('expired')) {
      logger.warn({ did: sessionDid, err: msg }, 'OAuth session invalid, clearing cookie');
      const { setCookie } = await import('hono/cookie');
      setCookie(c, 'cp_session', '', { maxAge: 0, path: '/' });
      return null;
    }
    throw err; // re-throw unexpected errors
  }
}

/**
 * Fetch a URL and extract the <title> tag, then update the citation record.
 * Runs in background — callers should .catch() errors.
 */
async function fetchAndSetTitle(citationId: number, url: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Centipedia/1.0 (citation-fetcher)' },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!res.ok) return;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return;

    const reader = res.body?.getReader();
    if (!reader) return;
    let htmlStr = '';
    while (htmlStr.length < 32768) {
      const { done, value } = await reader.read();
      if (done) break;
      htmlStr += new TextDecoder().decode(value);
      if (htmlStr.includes('</title>')) break;
    }
    reader.cancel().catch(() => {});

    const match = htmlStr.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (match?.[1]) {
      const title = match[1].trim().substring(0, 500);
      await db.query('UPDATE centipedia_citations SET title = $1 WHERE id = $2 AND title IS NULL', [title, citationId]);
      logger.info({ citationId, title }, 'Auto-fetched citation title');
    }
  } catch (err: any) {
    if (err.name === 'AbortError') return;
    throw err;
  }
}

/**
 * Write an endorsement record to the user's PDS (fire-and-forget).
 * This makes endorsements portable across apps in the AT Protocol.
 */
async function writeEndorsementRecord(
  c: any,
  sessionDid: string,
  collection: string,
  record: Record<string, any>
): Promise<void> {
  try {
    const oauthSession = await restoreSession(c, sessionDid);
    if (!oauthSession) return;
    const agent = new Agent(oauthSession as any);
    const tid = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    await agent.com.atproto.repo.createRecord({
      repo: sessionDid,
      collection,
      rkey: tid,
      record: {
        $type: collection,
        ...record,
        createdAt: new Date().toISOString(),
      },
    });
    logger.info({ collection, sessionDid }, 'Wrote endorsement record to PDS');
  } catch (err: any) {
    // Non-fatal — the DB endorsement is the source of truth
    logger.debug({ err, collection }, 'Failed to write endorsement to PDS (non-fatal)');
  }
}

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
        <button onclick="publishDraft()" id="publish-btn" style="background: #118156; color: white; border: none; padding: 0.4rem 1.2rem; border-radius: 99px; cursor: pointer; font-family: var(--font-sans); font-weight: 500; font-size: 14px;">Publish</button>
      </div>
    `;
    return c.html((
      <Layout title={`Draft - ${config.CENTIPEDIA_DOMAIN}`} profile={profile} headerAction={headerAction}>
        <script dangerouslySetInnerHTML={{ __html: `window.SESSION_DID = ${JSON.stringify(sessionDid)}; window.SESSION_HANDLE = ${JSON.stringify(profile?.handle || sessionDid)};` }} />
        <EditorPage />
      </Layout>
    ) as unknown as string);
  }

  // Centipedia home page
  const profile = sessionDid ? await fetchUserProfile(sessionDid) : null;

  // Fetch recent citations with endorsement counts
  const { rows: citationRows } = await db.query(
    `SELECT c.id, c.url, c.title, c.submitted_by, c.topic, c.status, c.created_at,
       (SELECT count(*) FROM centipedia_endorsement_citations e WHERE e.citation_id = c.id) AS endorsements
     FROM centipedia_citations c
     ORDER BY c.created_at DESC LIMIT 20`
  );

  // If logged in, get which citations this user has endorsed
  let userEndorsements = new Set<number>();
  if (sessionDid) {
    const { rows: endorsed } = await db.query(
      'SELECT citation_id FROM centipedia_endorsement_citations WHERE did = $1',
      [sessionDid]
    );
    userEndorsements = new Set(endorsed.map((r: any) => r.citation_id));
  }

  // Attach endorsement data to citations
  const citationsWithEndorsements = citationRows.map((r: any) => ({
    ...r,
    endorsements: Number(r.endorsements),
    userEndorsed: userEndorsements.has(r.id),
  }));

  // Stats
  const { rows: [statsRow] } = await db.query(`
    SELECT
      (SELECT count(*) FROM centipedia_citations) AS citations,
      (SELECT count(*) FROM centipedia_citations WHERE status = 'accepted') AS articles,
      (SELECT count(DISTINCT topic) FROM centipedia_citations WHERE topic IS NOT NULL) AS topics
  `);

  // Fetch published articles from bot's repo (cached)
  let articles: { rkey: string; title: string; excerpt: string; publishedAt: string; did: string }[] = [];
  try {
    const botDid = BOT_DID;
    const records = await getCachedListRecords(botDid, 'site.standard.document', 10, botDid);
    articles = records.map((r: any) => {
      const doc = r.value;
      return {
        rkey: r.uri.split('/').pop(),
        title: doc.title || 'Untitled',
        excerpt: extractExcerpt(doc, 160),
        publishedAt: doc.publishedAt || '',
        did: botDid,
      };
    });
  } catch (err: any) {
    logger.warn({ err }, 'Failed to fetch bot articles for home page');
  }

  return c.html((<HomePage
    citations={citationsWithEndorsements as CentipediaCitation[]}
    profile={profile}
    domain={config.CENTIPEDIA_DOMAIN}
    stats={{ articles: articles.length, citations: Number(statsRow.citations), topics: Number(statsRow.topics) }}
    articles={articles}
  />) as unknown as string);
});

app.get('/topics', async (c) => {
  const sessionDid = await getSession(c);
  const profile = sessionDid ? await fetchUserProfile(sessionDid) : null;

  const { rows } = await db.query(
    `SELECT topic, count(*) AS count, max(created_at) AS latest
     FROM centipedia_citations
     WHERE topic IS NOT NULL AND topic != ''
     GROUP BY topic
     ORDER BY count DESC`
  );

  return c.html((<TopicsPage
    topics={rows.map((r: any) => ({ topic: r.topic, count: Number(r.count), latest: r.latest?.toISOString() || '' }))}
    profile={profile}
  />) as unknown as string);
});

app.get('/submit', async (c) => {
  const sessionDid = await getSession(c);
  const profile = sessionDid ? await fetchUserProfile(sessionDid) : null;
  const prefillTopic = c.req.query('topic') || undefined;
  return c.html((<SubmitPage profile={profile} prefillTopic={prefillTopic} />) as unknown as string);
});

app.get('/my-citations', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.redirect('/login');
  const profile = await fetchUserProfile(sessionDid);

  const { rows: citations } = await db.query(
    `SELECT c.id, c.url, c.title, c.topic, c.excerpt, c.status, c.created_at, c.article_rkey, c.agent_notes,
       (SELECT count(*) FROM centipedia_endorsement_citations e WHERE e.citation_id = c.id) AS endorsements
     FROM centipedia_citations c
     WHERE c.submitted_by = $1
     ORDER BY c.created_at DESC`,
    [sessionDid]
  );

  const total = citations.length;
  const accepted = citations.filter((r: any) => r.status === 'accepted').length;
  const pending = citations.filter((r: any) => r.status === 'pending').length;
  const totalEndorsements = citations.reduce((sum: number, r: any) => sum + Number(r.endorsements), 0);

  return c.html((<MyCitationsPage
    citations={citations.map((r: any) => ({ ...r, endorsements: Number(r.endorsements) }))}
    profile={profile}
    stats={{ total, accepted, pending, totalEndorsements }}
    botDid={BOT_DID}
  />) as unknown as string);
});

// --- Atom Feed ---

app.get('/feed.xml', async (c) => {
  try {
    const botDid = BOT_DID;
    const baseUrl = `https://${config.CENTIPEDIA_DOMAIN}`;

    // Only show first-published articles (version 1) — regenerations don't re-surface
    const { rows: articles } = await db.query(
      `SELECT rkey, title, word_count, summary, created_at
       FROM centipedia_article_versions
       WHERE version = 1
       ORDER BY created_at DESC
       LIMIT 50`,
    );

    const recent = articles;

    const updated = recent.length > 0 ? new Date(recent[0].created_at).toISOString() : new Date().toISOString();

    const entries = recent.map((a: any) => {
      const articleUrl = `${baseUrl}/article/${a.rkey}`;
      const pubDate = new Date(a.created_at).toISOString();
      return `  <entry>
    <title>${escapeXml(a.title)}</title>
    <link href="${articleUrl}" />
    <id>${articleUrl}</id>
    <updated>${pubDate}</updated>
    <summary>${escapeXml(a.summary || `Encyclopedia article about ${a.title}`)}</summary>
    <content type="text">${escapeXml(a.summary || '')} — ${a.word_count} words</content>
    <author><name>Centipedia</name></author>
  </entry>`;
    }).join('\n');

    const feed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Centipedia</title>
  <subtitle>The agentic encyclopedia — knowledge synthesized from community-curated citations</subtitle>
  <link href="${baseUrl}/feed.xml" rel="self" />
  <link href="${baseUrl}" />
  <id>${baseUrl}/</id>
  <updated>${updated}</updated>
  <icon>${baseUrl}/favicon.png</icon>
${entries}
</feed>`;

    return new Response(feed, {
      headers: {
        'Content-Type': 'application/atom+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err: any) {
    logger.error({ err }, 'Failed to generate Atom feed');
    return c.text('Feed unavailable', 500);
  }
});

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

app.get('/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const sort = (c.req.query('sort') || 'relevant') as 'relevant' | 'latest';
  const sessionDid = await getSession(c);
  const profile = sessionDid ? await fetchUserProfile(sessionDid) : null;

  let results: SearchResult[] = [];

  if (q) {
    try {
      // Search centipedia articles (topics that have published articles)
      const { rows: articleHits } = await db.query(
        `SELECT DISTINCT c.topic, c.article_rkey,
           (SELECT count(*) FROM centipedia_citations cc WHERE cc.topic = c.topic AND cc.status = 'accepted') AS citation_count
         FROM centipedia_citations c
         WHERE c.article_rkey IS NOT NULL
           AND (c.topic ILIKE '%' || $1 || '%' OR c.article_rkey ILIKE '%' || $1 || '%')
           AND c.status = 'accepted'
         ORDER BY citation_count DESC
         LIMIT 10`,
        [q]
      );

      for (const hit of articleHits) {
        results.push({
          uri: `/article/${hit.article_rkey}`,
          did: BOT_DID,
          title: hit.topic || hit.article_rkey,
          site: `https://${config.CENTIPEDIA_DOMAIN}`,
          path: `/article/${hit.article_rkey}`,
          publishedAt: null,
          wordCount: 0,
          highlight: `${hit.citation_count} citations`,
          authorHandle: 'centipedia',
          authorName: 'Centipedia',
          authorAvatar: '',
        });
      }

      // Search local citations
      const { rows: citationHits } = await db.query(
        `SELECT c.id, c.url, c.title, c.topic, c.excerpt, c.article_rkey, c.created_at,
           (SELECT count(*) FROM centipedia_endorsement_citations e WHERE e.citation_id = c.id) AS endorsements
         FROM centipedia_citations c
         WHERE (c.title ILIKE '%' || $1 || '%' OR c.url ILIKE '%' || $1 || '%' OR c.topic ILIKE '%' || $1 || '%')
         AND c.status = 'accepted'
         ORDER BY endorsements DESC LIMIT 10`,
        [q]
      );

      for (const ch of citationHits) {
        results.push({
          uri: ch.url,
          did: '',
          title: `📎 ${ch.title || ch.url}`,
          site: ch.topic || null,
          path: ch.article_rkey ? `/article/${ch.article_rkey}` : null,
          publishedAt: ch.created_at?.toISOString() || null,
          wordCount: 0,
          highlight: ch.excerpt || null,
          authorHandle: 'citation',
          authorName: `${ch.endorsements} endorsements`,
          authorAvatar: '',
        });
      }
    } catch (err: any) {
      logger.error({ err, q }, 'Centipedia search failed');
    }
  }

  return c.html((<SearchPage query={q} results={results} sort={sort} profile={profile} domain={config.CENTIPEDIA_DOMAIN} />) as unknown as string);
});

app.get('/login', async (c) => {
  const sessionDid = await getSession(c);
  if (sessionDid) return c.redirect('/');

  return c.html((<Layout title={`Sign in — Centipedia`}>
    <div style="text-align: center; padding-top: 15vh;">
      <img src="/logo.jpg" alt="Centipedia" style="height: 64px; margin-bottom: 0.5rem;" onerror="this.outerHTML='<h1 style=\'font-family: var(--font-body); font-weight: 700; font-size: 54px; color: var(--text-main); letter-spacing: -0.03em; margin-bottom: 0.5rem;\'>Centipedia</h1>'" />
      <p style="color: var(--text-muted); font-family: var(--font-sans); margin-bottom: 3rem; font-size: 18px;">Sign in with your AT Protocol identity to contribute citations.</p>
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

app.get('/profile/:identifier', async (c) => {
  const identifier = c.req.param('identifier');
  const sessionDid = await getSession(c);
  const sessionProfile = sessionDid ? await fetchUserProfile(sessionDid) : null;

  // Resolve identifier to DID — can be a handle or DID (cached)
  let did: string;
  let handle: string;
  if (identifier.startsWith('did:')) {
    did = identifier;
    handle = identifier;
  } else {
    // Cache handle→DID resolution
    const { getRedis } = await import('../lib/redis.js');
    const redis = getRedis();
    const cacheKey = `pds:handle:${identifier}`;
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) {
      did = cached;
    } else {
      const res = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${identifier}`);
      if (!res.ok) return c.text('User not found', 404);
      const data = await res.json() as any;
      did = data.did;
      await redis.set(cacheKey, did, 'EX', 3600).catch(() => {});
    }
    handle = identifier;
  }

  // Fetch full profile from Bluesky (cached)
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
    const { getRedis } = await import('../lib/redis.js');
    const redis = getRedis();
    const profKey = `pds:fullprof:${did}`;
    const cached = await redis.get(profKey).catch(() => null);
    if (cached) {
      authorData = JSON.parse(cached);
    } else {
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
      await redis.set(profKey, JSON.stringify(authorData), 'EX', 86400).catch(() => {});
    }
  } catch (e) {}

  // Fetch articles this user contributed to (via their citations)
  const { rows: contributedRows } = await db.query(
    `SELECT DISTINCT c.article_rkey, 
       MIN(c.topic) AS topic,
       COUNT(c.id) AS user_citations,
       MIN(c.created_at) AS earliest_contribution
     FROM centipedia_citations c
     WHERE c.submitted_by = $1 AND c.status = 'accepted' AND c.article_rkey IS NOT NULL
     GROUP BY c.article_rkey
     ORDER BY earliest_contribution DESC`,
    [did]
  );

  const contributedArticles = contributedRows.map((r: any) => ({
    rkey: r.article_rkey,
    topic: r.topic || 'Untitled',
    userCitations: Number(r.user_citations),
    contributedAt: r.earliest_contribution?.toISOString() || '',
  }));

  // Fetch user's Centipedia citations
  const { rows: citationRows } = await db.query(
    `SELECT c.id, c.url, c.title, c.topic, c.status, c.article_rkey, c.created_at,
       (SELECT count(*) FROM centipedia_endorsement_citations e WHERE e.citation_id = c.id) AS endorsements
     FROM centipedia_citations c WHERE c.submitted_by = $1
     ORDER BY c.created_at DESC`,
    [did]
  );
  const profileCitations = citationRows.map((r: any) => ({
    ...r, endorsements: Number(r.endorsements)
  }));

  // Build trust stats
  const { rows: [endorseStats] } = await db.query(`
    SELECT
      (SELECT count(*) FROM centipedia_citations WHERE submitted_by = $1) AS citations_submitted,
      (SELECT count(*) FROM centipedia_citations WHERE submitted_by = $1 AND status = 'accepted') AS citations_accepted,
      (SELECT count(*) FROM centipedia_endorsement_submitters WHERE subject = $1) AS endorsements_received,
      (SELECT count(*) FROM centipedia_endorsement_submitters WHERE did = $1) + 
        (SELECT count(*) FROM centipedia_endorsement_citations WHERE did = $1) +
        (SELECT count(*) FROM centipedia_endorsement_sources WHERE did = $1) AS endorsements_given
  `, [did]);

  const { rows: domainRows } = await db.query(
    'SELECT domain FROM centipedia_endorsement_sources WHERE did = $1 ORDER BY created_at DESC LIMIT 10',
    [did]
  );

  const trustStats = {
    citationsSubmitted: Number(endorseStats.citations_submitted),
    citationsAccepted: Number(endorseStats.citations_accepted),
    endorsementsReceived: Number(endorseStats.endorsements_received),
    endorsementsGiven: Number(endorseStats.endorsements_given),
    trustedDomains: domainRows.map((r: any) => r.domain),
  };

  // Check if logged-in user has endorsed this person
  let isEndorsed = false;
  if (sessionDid && sessionDid !== did) {
    const { rows: endorseCheck } = await db.query(
      'SELECT id FROM centipedia_endorsement_submitters WHERE did = $1 AND subject = $2 AND topic IS NULL',
      [sessionDid, did]
    );
    isEndorsed = endorseCheck.length > 0;
  }

  return c.html((<ProfilePage
    author={authorData}
    sessionProfile={sessionProfile}
    domain={config.CENTIPEDIA_DOMAIN}
    botDid={BOT_DID}
    citations={profileCitations}
    trustStats={trustStats}
    isEndorsed={isEndorsed}
    contributedArticles={contributedArticles}
  />) as unknown as string);
});

// --- Topics page ---

app.get('/topics/:topic', async (c) => {
  const rawParam = decodeURIComponent(c.req.param('topic'));
  const topic = await resolveTopicSlug(rawParam);
  if (!topic) {
    return c.html((<NotFoundPage />) as unknown as string, 404);
  }
  const sessionDid = await getSession(c);
  const sessionProfile = sessionDid ? await fetchUserProfile(sessionDid) : null;

  // Fetch citations for this topic
  const { rows: citationRows } = await db.query(
    `SELECT c.id, c.url, c.title, c.status, c.excerpt, c.submitted_by, c.article_rkey, c.created_at,
       (SELECT count(*) FROM centipedia_endorsement_citations e WHERE e.citation_id = c.id) AS endorsements
     FROM centipedia_citations c
     WHERE c.topic = $1
     ORDER BY (SELECT count(*) FROM centipedia_endorsement_citations e WHERE e.citation_id = c.id) DESC, c.created_at DESC`,
    [topic]
  );

  // Get endorsement status for logged-in user
  let endorsedIds = new Set<number>();
  if (sessionDid) {
    const { rows: myEndorsements } = await db.query(
      `SELECT citation_id FROM centipedia_endorsement_citations WHERE did = $1 AND citation_id = ANY($2::int[])`,
      [sessionDid, citationRows.map((r: any) => r.id)]
    );
    endorsedIds = new Set(myEndorsements.map((r: any) => r.citation_id));
  }

  // Resolve submitter handles
  const submitterDids = [...new Set(citationRows.map((r: any) => r.submitted_by).filter(Boolean))];
  const handleMap: Record<string, string> = {};
  await Promise.all(submitterDids.map(async (sd) => {
    const p = await getCachedProfile(sd as string);
    if (p.handle) handleMap[sd as string] = p.handle;
  }));

  const citations = citationRows.map((r: any) => ({
    ...r,
    endorsements: Number(r.endorsements),
    submitter_handle: handleMap[r.submitted_by] || null,
    userEndorsed: endorsedIds.has(r.id),
  }));

  // Fetch articles linked to this topic
  const { rows: articleRkeys } = await db.query(
    `SELECT DISTINCT article_rkey FROM centipedia_citations WHERE topic = $1 AND article_rkey IS NOT NULL`,
    [topic]
  );

  const articles: any[] = [];
  for (const { article_rkey } of articleRkeys) {
    try {
      // Fetch article metadata from the versions table
      const { rows: [ver] } = await db.query(
        `SELECT title, word_count, summary, created_at FROM centipedia_article_versions
         WHERE rkey = $1 ORDER BY version DESC LIMIT 1`,
        [article_rkey]
      );
      if (ver) {
        articles.push({
          rkey: article_rkey,
          title: ver.title || topic,
          description: ver.summary || null,
          word_count: ver.word_count || 0,
          published_at: ver.created_at?.toISOString() || null,
        });
      }
    } catch {}
  }

  return c.html((<TopicPage
    topic={topic}
    citations={citations}
    articles={articles}
    sessionProfile={sessionProfile}
    botDid={BOT_DID}
  />) as unknown as string);
});

app.get('/new', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.redirect('/');
  const rkey = Math.random().toString(36).substring(2, 15);
  const docId = "at://" + sessionDid + "/site.standard.document/" + rkey;
  await db.query('INSERT INTO centipedia_drafts (document_name, owner_did, title) VALUES ($1, $2, $3)', [docId, sessionDid, 'Untitled']);
  return c.redirect('/?doc=' + encodeURIComponent(docId));
});

app.get('/posts', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.redirect('/');
  
  try {
    const profile = await fetchUserProfile(sessionDid);

    // Fetch drafts from DB
    const { rows: drafts } = await db.query(
      'SELECT document_name, title, published_uri, created_at, updated_at FROM centipedia_drafts WHERE owner_did = $1 ORDER BY updated_at DESC',
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
       FROM centipedia_drafts d
       JOIN centipedia_yjs_acl a ON d.document_name = a.document_name
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
      <Layout title={`My Work - ${config.CENTIPEDIA_DOMAIN}`} profile={profile}>
        {PostsPage(items, sharedItems, sessionDid)}
      </Layout>
    ) as unknown as string);
  } catch (err: any) {
    logger.error({ err }, 'Failed to fetch posts for dashboard');
    return c.html((<Layout title="Error"><h1>Error loading posts</h1><p>{err.message}</p></Layout>) as unknown as string);
  }
});

// --- Clean article URL (primary) ---

app.get('/article/:rkey', async (c) => {
  const rkey = c.req.param('rkey');
  const did = BOT_DID;
  
  try {
    const sessionDid = await getSession(c);
    
    // Cache-first: try Redis, then PDS
    const result = await getCachedRecordMulti(
      did,
      ['site.standard.document', 'pub.leaflet.document'],
      rkey,
      BOT_DID
    );
    if (!result) {
      return c.html((<Layout title="Post Not Found"><h1>Post Not Found</h1><p>Could not find this article.</p></Layout>) as unknown as string, 404);
    }
    
    const authorProfile = await getCachedProfile(did);
    const sessionProfile = sessionDid ? await getCachedProfile(sessionDid) : undefined;
    
    const doc = result.record as any;
    const canonicalUrl = `https://${config.CENTIPEDIA_DOMAIN}/article/${rkey}`;
    const excerpt = extractExcerpt(doc);
    const ogImageUrl = extractFirstImageUrl(doc, did);

    // Fetch citations linked to this article
    const { rows: citationRows } = await db.query(
      `SELECT c.id, c.url, c.title, c.submitted_by, c.topic, c.excerpt, c.status, c.created_at,
         (SELECT count(*) FROM centipedia_endorsement_citations e WHERE e.citation_id = c.id) AS endorsements
       FROM centipedia_citations c
       WHERE c.article_rkey = $1 AND c.status = 'accepted'
       ORDER BY endorsements DESC, c.created_at ASC`,
      [rkey]
    );

    // Fetch endorsement status for logged-in user
    let userEndorsedSet = new Set<number>();
    if (sessionDid) {
      const { rows: endorsed } = await db.query(
        'SELECT citation_id FROM centipedia_endorsement_citations WHERE did = $1',
        [sessionDid]
      );
      userEndorsedSet = new Set(endorsed.map((r: any) => r.citation_id));
    }

    const articleCitations = citationRows.map((r: any) => ({
      id: r.id,
      url: r.url,
      title: r.title || r.url,
      submittedBy: r.submitted_by,
      topic: r.topic,
      excerpt: r.excerpt,
      endorsements: Number(r.endorsements),
      userEndorsed: userEndorsedSet.has(r.id),
    }));

    // Resolve contributor profiles
    const contributorDids = [...new Set(citationRows.filter((r: any) => r.submitted_by).map((r: any) => r.submitted_by))] as string[];
    const contributors = await Promise.all(
      contributorDids.map(async (cdid: string) => {
        const p = await getCachedProfile(cdid);
        return { did: cdid, handle: p.handle, displayName: p.displayName, avatar: p.avatar };
      })
    );

    // Browser-level caching: serve stale for 2 min, revalidate for 1h
    if (!sessionDid) {
      c.header('Cache-Control', 'public, max-age=120, stale-while-revalidate=3600');
    }

    return c.html((<ArticleReaderPage
      doc={doc}
      did={did}
      rkey={rkey}
      authorProfile={authorProfile}
      sessionProfile={sessionProfile}
      domain={config.CENTIPEDIA_DOMAIN}
      canonicalUrl={canonicalUrl}
      ogImageUrl={ogImageUrl}
      excerpt={excerpt}
      citations={articleCitations}
      contributors={contributors}
    />) as unknown as string);
  } catch (err: any) {
    logger.error({ err, rkey }, 'Failed to load article');
    return c.html((<NotFoundPage />) as unknown as string, 404);
  }
});

// Legacy redirect: /post/:did/:rkey → /article/:rkey
app.get('/post/:did/:rkey', (c) => {
  const rkey = c.req.param('rkey');
  return c.redirect(`/article/${rkey}`, 301);
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
// --- Citation submission API ---

app.post('/api/citations', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.json({ error: 'Not authenticated' }, 401);

  // Rate limit: 10 citations per minute per user
  if (!rateLimit(`cite:${sessionDid}`, 10, 60_000)) {
    return c.json({ error: 'Too many submissions. Please wait a moment.' }, 429);
  }

  const body = await c.req.json();
  const url = body.url?.trim();
  const topic = body.topic?.trim() || null;
  const excerpt = body.excerpt?.trim() || null;

  if (!url || typeof url !== 'string') {
    return c.json({ error: 'URL is required' }, 400);
  }

  try {
    new URL(url); // validate URL format
  } catch {
    return c.json({ error: 'Invalid URL format' }, 400);
  }

  try {
    // Normalize URL for dedup
    const parsed = new URL(url);
    const normalizedUrl = parsed.origin.toLowerCase() + parsed.pathname.replace(/\/+$/, '') + parsed.search;

    // Check for duplicate
    const { rows: existing } = await db.query(
      'SELECT id, status FROM centipedia_citations WHERE url = $1 OR url = $2',
      [url, normalizedUrl]
    );
    if (existing.length > 0) {
      const dup = existing[0];
      return c.json({
        error: `This URL has already been submitted (status: ${dup.status})`,
        existingId: dup.id,
      }, 409);
    }

    const { rows: [inserted] } = await db.query(
      'INSERT INTO centipedia_citations (url, submitted_by, topic, excerpt, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [normalizedUrl, sessionDid || null, topic, excerpt, 'pending']
    );
    logger.info({ url: normalizedUrl, topic, submitter: sessionDid }, 'New citation submitted');

    // Auto-fetch title in background (don't block the response)
    const citationId = inserted.id;
    fetchAndSetTitle(citationId, normalizedUrl).catch(err => {
      logger.warn({ err, citationId, url: normalizedUrl }, 'Failed to auto-fetch citation title');
    });

    return c.json({ ok: true });
  } catch (err: any) {
    logger.error({ err }, 'Failed to store citation');
    return c.json({ error: 'Failed to submit citation' }, 500);
  }
});

// --- Citation endorsement API ---

app.post('/api/endorse/citation', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.json({ error: 'Not authenticated' }, 401);
  if (!rateLimit(`endorse:${sessionDid}`, 30, 60_000)) return c.json({ error: 'Too many actions' }, 429);

  const { citationId } = await c.req.json();
  if (!citationId) return c.json({ error: 'Missing citationId' }, 400);

  try {
    // Toggle: if already endorsed, remove it; otherwise add it
    const { rows: existing } = await db.query(
      'SELECT id FROM centipedia_endorsement_citations WHERE did = $1 AND citation_id = $2',
      [sessionDid, citationId]
    );

    if (existing.length > 0) {
      await db.query(
        'DELETE FROM centipedia_endorsement_citations WHERE did = $1 AND citation_id = $2',
        [sessionDid, citationId]
      );
      const { rows: [{ count }] } = await db.query(
        'SELECT count(*) FROM centipedia_endorsement_citations WHERE citation_id = $1',
        [citationId]
      );
      return c.json({ endorsed: false, count: Number(count) });
    } else {
      await db.query(
        'INSERT INTO centipedia_endorsement_citations (did, citation_id) VALUES ($1, $2)',
        [sessionDid, citationId]
      );
      // Write to PDS for portability
      writeEndorsementRecord(c, sessionDid, 'org.centipedia.endorsement.citation', { subject: String(citationId) }).catch(() => {});
      const { rows: [{ count }] } = await db.query(
        'SELECT count(*) FROM centipedia_endorsement_citations WHERE citation_id = $1',
        [citationId]
      );
      return c.json({ endorsed: true, count: Number(count) });
    }
  } catch (err: any) {
    logger.error({ err }, 'Failed to toggle citation endorsement');
    return c.json({ error: 'Failed to endorse' }, 500);
  }
});

// --- Submitter endorsement API ---

app.post('/api/endorse/submitter', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.json({ error: 'Not authenticated' }, 401);
  if (!rateLimit(`endorse:${sessionDid}`, 30, 60_000)) return c.json({ error: 'Too many actions' }, 429);

  const { subjectDid, topic } = await c.req.json();
  if (!subjectDid) return c.json({ error: 'Missing subjectDid' }, 400);
  if (subjectDid === sessionDid) return c.json({ error: 'Cannot endorse yourself' }, 400);

  try {
    const topicVal = topic?.trim() || null;
    const { rows: existing } = await db.query(
      'SELECT id FROM centipedia_endorsement_submitters WHERE did = $1 AND subject = $2 AND (topic = $3 OR ($3 IS NULL AND topic IS NULL))',
      [sessionDid, subjectDid, topicVal]
    );

    if (existing.length > 0) {
      await db.query(
        'DELETE FROM centipedia_endorsement_submitters WHERE did = $1 AND subject = $2 AND (topic = $3 OR ($3 IS NULL AND topic IS NULL))',
        [sessionDid, subjectDid, topicVal]
      );
      const { rows: [{ count }] } = await db.query(
        'SELECT count(*) FROM centipedia_endorsement_submitters WHERE subject = $1',
        [subjectDid]
      );
      return c.json({ endorsed: false, count: Number(count) });
    } else {
      await db.query(
        'INSERT INTO centipedia_endorsement_submitters (did, subject, topic) VALUES ($1, $2, $3)',
        [sessionDid, subjectDid, topicVal]
      );
      writeEndorsementRecord(c, sessionDid, 'org.centipedia.endorsement.submitter', { subject: subjectDid, ...(topicVal ? { topic: topicVal } : {}) }).catch(() => {});
      const { rows: [{ count }] } = await db.query(
        'SELECT count(*) FROM centipedia_endorsement_submitters WHERE subject = $1',
        [subjectDid]
      );
      return c.json({ endorsed: true, count: Number(count) });
    }
  } catch (err: any) {
    logger.error({ err }, 'Failed to toggle submitter endorsement');
    return c.json({ error: 'Failed to endorse' }, 500);
  }
});

// --- Domain endorsement API ---

app.post('/api/endorse/domain', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.json({ error: 'Not authenticated' }, 401);
  if (!rateLimit(`endorse:${sessionDid}`, 30, 60_000)) return c.json({ error: 'Too many actions' }, 429);

  const { domain, topic } = await c.req.json();
  if (!domain) return c.json({ error: 'Missing domain' }, 400);

  try {
    const normalizedDomain = domain.toLowerCase().replace(/^www\./, '').trim();
    const topicVal = topic?.trim() || null;
    const { rows: existing } = await db.query(
      'SELECT id FROM centipedia_endorsement_sources WHERE did = $1 AND domain = $2 AND (topic = $3 OR ($3 IS NULL AND topic IS NULL))',
      [sessionDid, normalizedDomain, topicVal]
    );

    if (existing.length > 0) {
      await db.query(
        'DELETE FROM centipedia_endorsement_sources WHERE did = $1 AND domain = $2 AND (topic = $3 OR ($3 IS NULL AND topic IS NULL))',
        [sessionDid, normalizedDomain, topicVal]
      );
      const { rows: [{ count }] } = await db.query(
        'SELECT count(*) FROM centipedia_endorsement_sources WHERE domain = $1',
        [normalizedDomain]
      );
      return c.json({ endorsed: false, count: Number(count) });
    } else {
      await db.query(
        'INSERT INTO centipedia_endorsement_sources (did, domain, topic) VALUES ($1, $2, $3)',
        [sessionDid, normalizedDomain, topicVal]
      );
      writeEndorsementRecord(c, sessionDid, 'org.centipedia.endorsement.source', { domain: normalizedDomain, ...(topicVal ? { topic: topicVal } : {}) }).catch(() => {});
      const { rows: [{ count }] } = await db.query(
        'SELECT count(*) FROM centipedia_endorsement_sources WHERE domain = $1',
        [normalizedDomain]
      );
      return c.json({ endorsed: true, count: Number(count) });
    }
  } catch (err: any) {
    logger.error({ err }, 'Failed to toggle domain endorsement');
    return c.json({ error: 'Failed to endorse' }, 500);
  }
});

// --- Article version history API ---

app.get('/api/article-versions/:rkey', async (c) => {
  const rkey = c.req.param('rkey');
  try {
    const { rows: versions } = await db.query(
      `SELECT version, title, word_count, citations_used, summary, generated_by, created_at
       FROM centipedia_article_versions WHERE rkey = $1
       ORDER BY version DESC`,
      [rkey]
    );
    return c.json({ rkey, versions });
  } catch (err: any) {
    logger.error({ err }, 'Failed to fetch article versions');
    return c.json({ error: 'Internal error' }, 500);
  }
});

// --- "Your Network" trust-weighted scores API ---

app.get('/api/network-scores', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.json({ error: 'Not authenticated' }, 401);

  const rkey = c.req.query('rkey');
  if (!rkey) return c.json({ error: 'Missing rkey' }, 400);

  try {
    // Step 1: Get people the viewer has endorsed (their trust graph)
    const { rows: trustedPeople } = await db.query(
      'SELECT DISTINCT subject FROM centipedia_endorsement_submitters WHERE did = $1',
      [sessionDid]
    );
    const trustedDids = trustedPeople.map((r: any) => r.subject);

    // Step 2: Get domains the viewer trusts
    const { rows: trustedDomainRows } = await db.query(
      'SELECT DISTINCT domain FROM centipedia_endorsement_sources WHERE did = $1',
      [sessionDid]
    );
    const trustedDomains = trustedDomainRows.map((r: any) => r.domain);

    // Step 3: For each citation on this article, compute network score
    const { rows: citations } = await db.query(
      `SELECT c.id, c.url, c.submitted_by,
         (SELECT count(*) FROM centipedia_endorsement_citations e WHERE e.citation_id = c.id) AS global_endorsements
       FROM centipedia_citations c
       WHERE c.article_rkey = $1 AND c.status = 'accepted'`,
      [rkey]
    );

    const scores = await Promise.all(citations.map(async (cit: any) => {
      let networkScore = 0;

      // Points from trusted people endorsing this citation
      if (trustedDids.length > 0) {
        const { rows: [{ count: trustedEndorsements }] } = await db.query(
          `SELECT count(*) FROM centipedia_endorsement_citations
           WHERE citation_id = $1 AND did = ANY($2::text[])`,
          [cit.id, trustedDids]
        );
        networkScore += Number(trustedEndorsements) * 3; // 3x weight for trusted endorsers
      }

      // Points if submitted by a trusted person
      if (cit.submitted_by && trustedDids.includes(cit.submitted_by)) {
        networkScore += 2;
      }

      // Points if from a trusted domain
      try {
        const citDomain = new URL(cit.url).hostname.replace(/^www\./, '');
        if (trustedDomains.includes(citDomain)) {
          networkScore += 1;
        }
      } catch {}

      // Viewer's own endorsement
      const { rows: ownEndorse } = await db.query(
        'SELECT id FROM centipedia_endorsement_citations WHERE did = $1 AND citation_id = $2',
        [sessionDid, cit.id]
      );
      if (ownEndorse.length > 0) networkScore += 5; // highest weight for own endorsement

      return {
        citationId: cit.id,
        globalScore: Number(cit.global_endorsements),
        networkScore,
      };
    }));

    return c.json({
      scores,
      networkSize: trustedDids.length,
      trustedDomains: trustedDomains.length,
    });
  } catch (err: any) {
    logger.error({ err }, 'Failed to compute network scores');
    return c.json({ error: 'Internal error' }, 500);
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
    'SELECT permission FROM centipedia_yjs_acl WHERE document_name = $1 AND did IN ($2, $3) ORDER BY CASE WHEN did = $2 THEN 0 ELSE 1 END LIMIT 1',
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
      'INSERT INTO centipedia_drafts (document_name, owner_did, title) VALUES ($1, $2, $3)',
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
      await db.query('DELETE FROM centipedia_yjs_acl WHERE document_name = $1', [docId]);
      await db.query('DELETE FROM centipedia_yjs_documents WHERE name = $1', [docId]);
      await db.query('DELETE FROM centipedia_drafts WHERE document_name = $1 AND owner_did = $2', [docId, sessionDid]);
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
     const leafletDoc = await serializeTiptapToLeaflet(documentJson, title, sessionDid, agent, rkey);
     
     const res = await agent.com.atproto.repo.createRecord({
       repo: sessionDid,
       collection: 'site.standard.document',
       rkey: rkey,
       record: leafletDoc
     });
     
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
     logger.info({ event: 'centipedia_publish', did: sessionDid, handle: authorHandle, uri: res.data.uri }, 'User successfully published a document');
     
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
          'UPDATE centipedia_drafts SET published_uri = $1, title = $2, updated_at = NOW() WHERE document_name = $3',
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
  if (!url) return c.json({ error: 'Missing url parameter' }, 400);
  
  try {
    const agent = await getLongformBot();
    if (!agent) return c.json({ posts: [] });
    
    const res = await agent.app.bsky.feed.searchPosts({ q: url, limit: 15 });
    return c.json(res.data);
  } catch (err: any) {
    logger.error({ err, url }, 'Failed to fetch comments');
    return c.json({ error: 'Search failed' }, 500);
  }
});

app.post('/api/like', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.json({ error: 'Unauthorized' }, 401);
  
  try {
    const { rkey, authorDid } = await c.req.json();
    const oauthSession = await restoreSession(c, sessionDid);
    if (!oauthSession) return c.json({ error: 'Session expired' }, 401);
    const agent = new Agent(oauthSession);
    
    const articleUri = `at://${authorDid}/site.standard.document/${rkey}`;
    
    // Create PDS record (protocol-level like)
    let recordUri: string | null = null;
    try {
      // We need the CID for a proper like subject
      const record = await getCachedRecord(authorDid, 'site.standard.document', rkey, BOT_DID);
      if (record) {
        const pdsUrl = await resolvePds(authorDid);
        const fetchAgent = new BskyAgent({ service: pdsUrl });
        const recRes = await fetchAgent.com.atproto.repo.getRecord({
          repo: authorDid, collection: 'site.standard.document', rkey
        });
        const res = await agent.com.atproto.repo.createRecord({
          repo: sessionDid,
          collection: 'app.bsky.feed.like',
          record: {
            subject: { uri: articleUri, cid: recRes.data.cid },
            createdAt: new Date().toISOString()
          }
        });
        recordUri = res.data.uri;
      }
    } catch (err) {
      logger.debug({ err }, 'PDS like record creation failed (non-fatal)');
    }
    
    // Track locally (source of truth for stats)
    await db.query(
      `INSERT INTO article_interactions (article_uri, actor_did, interaction_type, record_uri)
       VALUES ($1, $2, 'like', $3) ON CONFLICT (article_uri, actor_did, interaction_type) DO NOTHING`,
      [articleUri, sessionDid, recordUri]
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
    const { rkey, authorDid } = await c.req.json();
    const oauthSession = await restoreSession(c, sessionDid);
    if (!oauthSession) return c.json({ error: 'Session expired' }, 401);
    const agent = new Agent(oauthSession);
    
    const articleUri = `at://${authorDid}/site.standard.document/${rkey}`;
    
    // Create PDS record (protocol-level repost)
    let recordUri: string | null = null;
    try {
      const pdsUrl = await resolvePds(authorDid);
      const fetchAgent = new BskyAgent({ service: pdsUrl });
      const recRes = await fetchAgent.com.atproto.repo.getRecord({
        repo: authorDid, collection: 'site.standard.document', rkey
      });
      const res = await agent.com.atproto.repo.createRecord({
        repo: sessionDid,
        collection: 'app.bsky.feed.repost',
        record: {
          subject: { uri: articleUri, cid: recRes.data.cid },
          createdAt: new Date().toISOString()
        }
      });
      recordUri = res.data.uri;
    } catch (err) {
      logger.debug({ err }, 'PDS repost record creation failed (non-fatal)');
    }
    
    // Track locally
    await db.query(
      `INSERT INTO article_interactions (article_uri, actor_did, interaction_type, record_uri)
       VALUES ($1, $2, 'repost', $3) ON CONFLICT (article_uri, actor_did, interaction_type) DO NOTHING`,
      [articleUri, sessionDid, recordUri]
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
    
    return c.json({ likes, reposts, liked, reposted });
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
  
  const { rows } = await db.query('SELECT did, permission FROM centipedia_yjs_acl WHERE document_name = $1', [docId]);
  
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
      `INSERT INTO centipedia_yjs_acl (document_name, did, permission) VALUES ($1, $2, $3)
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

  await db.query('DELETE FROM centipedia_yjs_acl WHERE document_name = $1 AND did = $2', [docId, did]);
  return c.json({ success: true });
});

const collabServer = HocuspocusServer.configure({
  name: 'centipedia-collab',
  extensions: [hocuspocusDb],
  async onAuthenticate(data) {
    const cookieHeader = data.request.headers.cookie || '';
    const match = cookieHeader.match(/cp_session=([^;]+)/);
    const did = match ? decodeURIComponent(match[1]) : 'anonymous';

    const docName = data.documentName;
    if (docName.startsWith('at://')) {
      const ownerDid = docName.split('/')[2];
      if (did === ownerDid) return { user: { id: did, permission: 'write' } };
      
      // Check specific DID permission first, then wildcard '*' (public access)
      const { rows } = await db.query(
        'SELECT permission FROM centipedia_yjs_acl WHERE document_name = $1 AND did IN ($2, $3) ORDER BY CASE WHEN did = $2 THEN 0 ELSE 1 END LIMIT 1',
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

// Custom 404 page
app.notFound((c) => {
  return c.html((<NotFoundPage />) as unknown as string, 404);
});

// Startup hook
async function start() {
  const server = serve({ fetch: app.fetch, port: config.CENTIPEDIA_PORT }, (info) => {
    logger.info({ port: info.port, domain: config.CENTIPEDIA_DOMAIN }, 'Centipedia service started');
  });
  
  server.on('upgrade', (request, socket, head) => {
    if (request.url === '/collab' || request.url?.startsWith('/collab/')) {
      // Pass the upgrade to ws server
      wss.handleUpgrade(request, socket, head, (ws) => {
        collabServer.handleConnection(ws, request);
      });
    }
  });

  // Start the research agent
  startResearchAgent();
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start centipedia web server');
  process.exit(1);
});

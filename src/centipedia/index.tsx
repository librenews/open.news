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
import type { CentipediaCitation } from './views/home.js';
import { ProfilePage } from './views/profile.js';
import { SearchPage } from './views/search.js';
import { NotFoundPage } from './views/notfound.js';
import type { ProfileData, ProfileStory } from './views/profile.js';
import type { SearchResult } from './views/search.js';
import { authRouter, getSession, getCentipediaAuthClient } from './routes/auth.js';
import { Agent, BskyAgent } from '@atproto/api';
import { serializeTiptapToLeaflet } from './lib/leafletExporter.js';
import { resolvePds } from '../lib/pds.js';
import { announceArticle, getCentipediaBot } from './bot.js';
import { Server as HocuspocusServer } from '@hocuspocus/server';
import { hocuspocusDb } from './lib/hocuspocusDb.js';
import { WebSocketServer } from 'ws';
import { db } from '../db/client.js';
import { searchSiteStandardArticles } from '../track/opensearch.js';

process.on('unhandledRejection', (err) => {
  logger.warn({ err }, 'Caught unhandled promise rejection in Longform (likely a background OAuth token getter)');
});

const app = new Hono();

app.use('/logo.jpg', serveStatic({ root: './src/centipedia/public', path: 'logo.jpg' }));
app.use('/favicon.png', serveStatic({ root: './src/centipedia/public', path: 'favicon.png' }));

app.route('/', authRouter);

async function fetchUserProfile(did: string) {
  try {
    const profileRes = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`).then(r => r.json());
    if (profileRes && !profileRes.error) {
      return {
        displayName: profileRes.displayName || profileRes.handle || did,
        avatar: profileRes.avatar || '',
        handle: profileRes.handle || did
      };
    }
  } catch (e) {}
  return { displayName: did, avatar: '', handle: did };
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

  // Fetch recent citations
  const { rows: citationRows } = await db.query(
    'SELECT id, url, title, submitted_by, topic, status, created_at FROM centipedia_citations ORDER BY created_at DESC LIMIT 20'
  );

  // Stats
  const { rows: [statsRow] } = await db.query(`
    SELECT
      (SELECT count(*) FROM centipedia_citations) AS citations,
      (SELECT count(*) FROM centipedia_citations WHERE status = 'accepted') AS articles,
      (SELECT count(DISTINCT topic) FROM centipedia_citations WHERE topic IS NOT NULL) AS topics
  `);

  return c.html((<HomePage
    citations={citationRows as CentipediaCitation[]}
    profile={profile}
    domain={config.CENTIPEDIA_DOMAIN}
    stats={{ articles: Number(statsRow.articles), citations: Number(statsRow.citations), topics: Number(statsRow.topics) }}
  />) as unknown as string);
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
    `SELECT uri, author_did, title, description, published_at, site, path, word_count,
       split_part(uri, '/', 4) AS collection,
       CASE WHEN uri LIKE '%/site.standard.document/%' OR uri LIKE '%/pub.leaflet.document/%'
         THEN jsonb_path_query_first(raw_record, '$.content.pages[0].blocks[*].block ? (@."$type" == "pub.leaflet.blocks.image").image.ref."$link"') #>> '{}'
         ELSE NULL
       END AS image_cid,
       CASE WHEN raw_record->>'site' LIKE 'at://%site.standard.publication%'
         THEN raw_record->>'site'
         ELSE NULL
       END AS publication_uri
     FROM site_standard_articles
     WHERE author_did = $1
     ORDER BY published_at DESC`,
    [did]
  );

  const stories: ProfileStory[] = rows.map((r: any) => {
    const rkey = r.uri.split('/').pop();
    const collection = r.collection;
    let readUrl: string | null = null;
    if (r.site && r.path && r.site.startsWith('http')) {
      readUrl = `${r.site}${r.path}`;
    } else if (collection === 'com.whtwnd.blog.entry') {
      readUrl = `https://whtwnd.com/${authorData.handle}/${rkey}`;
    }
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

  return c.html((<ProfilePage author={authorData} stories={stories} sessionProfile={sessionProfile} domain={config.CENTIPEDIA_DOMAIN} />) as unknown as string);
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

app.get('/post/:did/:rkey', async (c) => {
  const did = c.req.param('did');
  const rkey = c.req.param('rkey');
  
  try {
    // Unauthenticated fetch to public AppView since records are public
    // Wait, site.standard.document isn't guaranteed to be indexed by public AppView yet.
    // Let's use the authenticated agent if there's a session, otherwise we'd hit the specific PDS directly.
    // For MVP, we'll try to fetch it via the public AppView, and fallback if needed, 
    // but the safest approach since we don't have the PDS URL is to use the AppView's atproto endpoints!
    const sessionDid = await getSession(c);
    let agentToUse;
    
    if (sessionDid) {
      const oauthSession = await restoreSession(c, sessionDid);
      if (oauthSession) {
        agentToUse = new Agent(oauthSession);
      }
    } else {
      // Resolve the author's specific PDS for unauthenticated fetching
      try {
        const pdsUrl = await resolvePds(did);
        agentToUse = new BskyAgent({ service: pdsUrl }) as any;
      } catch (e) {
        agentToUse = new BskyAgent({ service: 'https://public.api.bsky.app' }) as any;
      }
    }
    
    // Try multiple collection types — site.standard.document first, then pub.leaflet.document
    const collections = ['site.standard.document', 'pub.leaflet.document'];
    let record: any = null;
    for (const collection of collections) {
      try {
        record = await agentToUse.com.atproto.repo.getRecord({
          repo: did,
          collection,
          rkey: rkey
        });
        break;
      } catch (e) {
        // Try next collection
      }
    }
    if (!record) {
      return c.html((<Layout title="Post Not Found"><h1>Post Not Found</h1><p>Could not find this article.</p></Layout>) as unknown as string, 404);
    }
    
    // Fetch author profile
    const authorProfile = await fetchUserProfile(did);
    const sessionProfile = sessionDid ? await fetchUserProfile(sessionDid) : undefined;
    
    const doc = record.data.value as any;
    
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
      url: `https://${config.CENTIPEDIA_DOMAIN}/post/${did}/${rkey}`,
    };
    
    return c.html((
      <Layout title={`${doc.title} - ${config.CENTIPEDIA_DOMAIN}`} profile={sessionProfile} og={og}>
        {ReaderPage(doc, did, authorProfile)}
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
  const body = await c.req.json();
  const url = body.url?.trim();
  const topic = body.topic?.trim() || null;

  if (!url || typeof url !== 'string') {
    return c.json({ error: 'URL is required' }, 400);
  }

  try {
    new URL(url); // validate URL format
  } catch {
    return c.json({ error: 'Invalid URL format' }, 400);
  }

  try {
    await db.query(
      'INSERT INTO centipedia_citations (url, submitted_by, topic, status) VALUES ($1, $2, $3, $4)',
      [url, sessionDid || null, topic, 'pending']
    );
    logger.info({ url, topic, submitter: sessionDid }, 'New citation submitted');
    return c.json({ ok: true });
  } catch (err: any) {
    logger.error({ err }, 'Failed to store citation');
    return c.json({ error: 'Failed to submit citation' }, 500);
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
    
    await agent.com.atproto.repo.createRecord({
      repo: sessionDid,
      collection: 'app.bsky.feed.like',
      record: {
        subject: { uri, cid },
        createdAt: new Date().toISOString()
      }
    });
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
    
    await agent.com.atproto.repo.createRecord({
      repo: sessionDid,
      collection: 'app.bsky.feed.repost',
      record: {
        subject: { uri, cid },
        createdAt: new Date().toISOString()
      }
    });
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
  
  try {
    const botAgent = await getLongformBot();
    if (!botAgent) return c.json({ likes: 0, reposts: 0, liked: false, reposted: false });
    
    // Resolve PDS to get CID
    const pdsUrl = await resolvePds(authorDid);
    const fetchAgent = new BskyAgent({ service: pdsUrl });
    const record = await fetchAgent.com.atproto.repo.getRecord({
      repo: authorDid,
      collection: 'site.standard.document',
      rkey
    });
    
    const uri = `at://${authorDid}/site.standard.document/${rkey}`;
    const cid = record.data.cid;
    
    const [likesRes, repostsRes] = await Promise.all([
      botAgent.app.bsky.feed.getLikes({ uri, cid }).catch(() => null),
      botAgent.app.bsky.feed.getRepostedBy({ uri, cid }).catch(() => null)
    ]);
    
    let liked = false;
    let reposted = false;
    
    if (sessionDid) {
      if (likesRes?.data?.likes) {
        liked = likesRes.data.likes.some((l: any) => l.actor.did === sessionDid);
      }
      if (repostsRes?.data?.repostedBy) {
        reposted = repostsRes.data.repostedBy.some((r: any) => r.did === sessionDid);
      }
    }
    
    return c.json({
      likes: likesRes?.data?.likes?.length || 0,
      reposts: repostsRes?.data?.repostedBy?.length || 0,
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
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start centipedia web server');
  process.exit(1);
});

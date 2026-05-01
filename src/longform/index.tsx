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
import { authRouter, getSession, getLongformAuthClient } from './routes/auth.js';
import { Agent, BskyAgent } from '@atproto/api';
import { serializeTiptapToLeaflet } from './lib/leafletExporter.js';
import { resolvePds } from '../lib/pds.js';
import { announcePublication, getLongformBot } from './bot.js';

process.on('unhandledRejection', (err) => {
  logger.warn({ err }, 'Caught unhandled promise rejection in Longform (likely a background OAuth token getter)');
});

const app = new Hono();

app.use('/logo.png', serveStatic({ root: './src/longform/public', path: 'logo.png' }));
app.use('/favicon.png', serveStatic({ root: './src/longform/public', path: 'favicon.png' }));

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

app.get('/', async (c) => {
  const sessionDid = await getSession(c);
  
  if (!sessionDid) {
    return c.html((
      <Layout title={`Login to Longform - Write securely on the AT Protocol`}>
        <div style="text-align: center; padding-top: 20vh;">
          <img src="/logo.png" alt="Longform" style="height: 64px; margin-bottom: 0.5rem;" onerror="this.outerHTML='<h1 style=\\'font-family: var(--font-body); font-weight: 700; font-size: 54px; color: var(--text-main); letter-spacing: -0.03em; margin-bottom: 0.5rem;\\'>Longform</h1>'" />
          <p style="color: var(--text-muted); font-family: var(--font-sans); margin-bottom: 3rem; font-size: 18px;">Sign in to your ATproto PDS to write.</p>
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
      </Layout>
    ) as unknown as string);
  }

  const profile = await fetchUserProfile(sessionDid);

  const headerAction = html`<button onclick="publishDraft()" id="publish-btn" style="background: #118156; color: white; border: none; padding: 0.4rem 1.2rem; border-radius: 99px; cursor: pointer; font-family: var(--font-sans); font-weight: 500;">Publish</button>`;

  return c.html((
    <Layout title={`Draft - ${config.LONGFORM_DOMAIN}`} profile={profile} headerAction={headerAction}>
      <EditorPage />
    </Layout>
  ) as unknown as string);
});

app.get('/posts', async (c) => {
  const sessionDid = await getSession(c);
  if (!sessionDid) return c.redirect('/');
  
  try {
    const client = await getLongformAuthClient();
    const oauthSession = await client.restore(sessionDid);
    const agent = new Agent(oauthSession);
    
    // Fetch all site.standard.document records for the user
    const res = await agent.com.atproto.repo.listRecords({
      repo: sessionDid,
      collection: 'site.standard.document',
      limit: 100
    });
    
    const profile = await fetchUserProfile(sessionDid);
    
    return c.html((
      <Layout title={`My Posts - ${config.LONGFORM_DOMAIN}`} profile={profile}>
        {PostsPage(res.data.records as any, sessionDid)}
      </Layout>
    ) as unknown as string);
  } catch (err: any) {
    logger.error({ err }, 'Failed to fetch posts for dashboard');
    return c.html((<Layout title="Error"><h1>Error loading posts</h1><p>${err.message}</p></Layout>) as unknown as string);
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
      const client = await getLongformAuthClient();
      const oauthSession = await client.restore(sessionDid);
      agentToUse = new Agent(oauthSession);
    } else {
      // Resolve the author's specific PDS for unauthenticated fetching
      try {
        const pdsUrl = await resolvePds(did);
        agentToUse = new BskyAgent({ service: pdsUrl }) as any;
      } catch (e) {
        agentToUse = new BskyAgent({ service: 'https://public.api.bsky.app' }) as any;
      }
    }
    
    const record = await agentToUse.com.atproto.repo.getRecord({
      repo: did,
      collection: 'site.standard.document',
      rkey: rkey
    });
    
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
      url: `https://${config.LONGFORM_DOMAIN}/post/${did}/${rkey}`,
    };
    
    return c.html((
      <Layout title={`${doc.title} - ${config.LONGFORM_DOMAIN}`} profile={sessionProfile} og={og}>
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
    const sessionDid = await getSession(c);
    let agentToUse;
    
    if (sessionDid) {
      const client = await getLongformAuthClient();
      const oauthSession = await client.restore(sessionDid);
      agentToUse = new Agent(oauthSession);
    } else {
      try {
        const pdsUrl = await resolvePds(did);
        agentToUse = new BskyAgent({ service: pdsUrl }) as any;
      } catch (e) {
        agentToUse = new BskyAgent({ service: 'https://public.api.bsky.app' }) as any;
      }
    }
    
    const blobRes = await agentToUse.com.atproto.sync.getBlob({ did, cid });
    
    return c.body(blobRes.data as any, 200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000'
    });
  } catch (err: any) {
    logger.error({ err, did, cid }, 'Failed to fetch blob from PDS');
    return c.text('Image not found', 404);
  }
});

app.post('/api/publish', async (c) => {
   const sessionDid = await getSession(c);
   if (!sessionDid) return c.json({ error: 'Unauthorized' }, 401);
   
   try {
     const body = await c.req.json();
     const client = await getLongformAuthClient();
     const oauthSession = await client.restore(sessionDid);
     const agent = new Agent(oauthSession);
     
     const title = body.title || 'Untitled Draft';
     const rkey = Math.random().toString(36).substring(2, 15);
     const documentJson = body.document;
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
    const client = await getLongformAuthClient();
    const oauthSession = await client.restore(sessionDid);
    const agent = new Agent(oauthSession);
    
    // Construct the AT URI
    const uri = `at://${authorDid}/site.standard.document/${rkey}`;
    // We need the CID to like it. Fetch the record from author's PDS to get CID
    const pdsUrl = await resolvePds(authorDid);
    const fetchAgent = new BskyAgent({ service: pdsUrl });
    const record = await fetchAgent.com.atproto.repo.getRecord({
      repo: authorDid,
      collection: 'site.standard.document',
      rkey
    });
    
    await agent.com.atproto.repo.createRecord({
      repo: sessionDid,
      collection: 'app.bsky.feed.like',
      record: {
        subject: { uri, cid: record.data.cid },
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
    const { rkey, authorDid } = await c.req.json();
    const client = await getLongformAuthClient();
    const oauthSession = await client.restore(sessionDid);
    const agent = new Agent(oauthSession);
    
    const uri = `at://${authorDid}/site.standard.document/${rkey}`;
    const pdsUrl = await resolvePds(authorDid);
    const fetchAgent = new BskyAgent({ service: pdsUrl });
    const record = await fetchAgent.com.atproto.repo.getRecord({
      repo: authorDid,
      collection: 'site.standard.document',
      rkey
    });
    
    await agent.com.atproto.repo.createRecord({
      repo: sessionDid,
      collection: 'app.bsky.feed.repost',
      record: {
        subject: { uri, cid: record.data.cid },
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

// Startup hook
async function start() {
  serve({ fetch: app.fetch, port: config.LONGFORM_PORT }, (info) => {
    logger.info({ port: info.port, domain: config.LONGFORM_DOMAIN }, 'Longform service started');
  });
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start longform web server');
  process.exit(1);
});

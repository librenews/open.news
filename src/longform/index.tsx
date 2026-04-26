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
import { Agent } from '@atproto/api';
import { serializeTiptapToLeaflet } from './lib/leafletExporter.js';

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
    
    // Fetch all pub.leaflet.document records for the user
    const res = await agent.com.atproto.repo.listRecords({
      repo: sessionDid,
      collection: 'pub.leaflet.document',
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
    // Wait, pub.leaflet.document isn't guaranteed to be indexed by public AppView yet.
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
      // Fallback to unauthenticated agent hitting the public appview
      agentToUse = new Agent({ service: 'https://public.api.bsky.app' });
    }
    
    const record = await agentToUse.com.atproto.repo.getRecord({
      repo: did,
      collection: 'pub.leaflet.document',
      rkey: rkey
    });
    
    // Fetch author profile
    const authorProfile = await fetchUserProfile(did);
    const sessionProfile = sessionDid ? await fetchUserProfile(sessionDid) : undefined;
    
    const doc = record.data.value as any;
    
    return c.html((
      <Layout title={`${doc.title} - ${config.LONGFORM_DOMAIN}`} profile={sessionProfile}>
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
      agentToUse = new Agent({ service: 'https://public.api.bsky.app' });
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
     const leafletDoc = await serializeTiptapToLeaflet(body.document, title, sessionDid, agent);
     
     const res = await agent.com.atproto.repo.createRecord({
       repo: sessionDid,
       collection: 'pub.leaflet.document',
       record: leafletDoc
     });
     
     return c.json({ success: true, uri: res.data.uri, cid: res.data.cid });
   } catch (err: any) {
     logger.error({ err }, 'Failed to publish Leaflet document from Longform');
     return c.json({ error: err.message }, 500);
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

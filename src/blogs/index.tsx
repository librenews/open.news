import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getCachedProfile, getCachedRecordMulti } from '../lib/pdsCache.js';
import { BlogsLayout } from './views/layout.js';
import { FeedPage, type FeedItem } from './views/feed.js';
import { AuthorPage, type AuthorProfile, type AuthorPost } from './views/author.js';
import { StatsPage } from './views/stats.js';
import { getBlogStats } from './lib/statsCache.js';
import { blogsAuthRouter, getBlogsSession } from './routes/auth.js';
import { blogsFollowRouter } from './routes/follow.js';
import { blogsComposeRouter } from './routes/compose.js';
import { attachLiveFeed } from './lib/liveFeed.js';

const app = new Hono();

// ── Auth routes ─────────────────────────────────────────────────────────────
app.route('/', blogsAuthRouter);

// ── Follow routes ────────────────────────────────────────────────────────────
app.route('/', blogsFollowRouter);

// ── Compose routes ──────────────────────────────────────────────────────────
app.route('/', blogsComposeRouter);

// ── Helper: get set of DIDs the current user follows ─────────────────────────
async function getFollowedDids(followerDid: string | null): Promise<Set<string>> {
  if (!followerDid) return new Set();
  try {
    const { rows } = await db.query(
      'SELECT following_did FROM blogs_follows WHERE follower_did = $1',
      [followerDid]
    );
    return new Set(rows.map((r: any) => r.following_did));
  } catch {
    return new Set();
  }
}

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/health', async (c) => {
  try {
    await db.query('SELECT 1');
    return c.json({ status: 'ok', service: 'blogs' });
  } catch {
    return c.json({ status: 'error' }, 503);
  }
});

// ── Feed (Homepage) ─────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const session = await getBlogsSession(c);
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const perPage = 30;
  const offset = (page - 1) * perPage;

  const { rows } = await db.query(`
    SELECT
      s.uri, s.author_did, s.title,
      s.site, s.path, s.published_at,
      s.word_count, s.created_at,
      COALESCE(s.description, LEFT(s.raw_record->>'textContent', 600)) AS text_content,
      s.raw_record->'tags' AS tags_json
    FROM site_standard_articles s
    ORDER BY s.created_at DESC
    LIMIT $1 OFFSET $2
  `, [perPage, offset]);

  // Resolve profiles
  const uniqueDids = [...new Set(rows.map((r: any) => r.author_did))];
  const profileMap: Record<string, { handle: string; avatar: string; displayName: string }> = {};
  await Promise.all(uniqueDids.slice(0, 30).map(async (did) => {
    try {
      const p = await getCachedProfile(did as string);
      profileMap[did as string] = {
        handle: p.handle || did as string,
        avatar: p.avatar || '',
        displayName: p.displayName || ''
      };
    } catch {
      profileMap[did as string] = { handle: did as string, avatar: '', displayName: '' };
    }
  }));

  const items: FeedItem[] = rows.map((r: any) => {
    const uriParts = r.uri.replace('at://', '').split('/');
    const rkey = uriParts[uriParts.length - 1];
    const profile = profileMap[r.author_did] || { handle: r.author_did, avatar: '', displayName: '' };

    let tags: string[] = [];
    try {
      if (r.tags_json && Array.isArray(r.tags_json)) tags = r.tags_json;
    } catch {}

    return {
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
      tags,
      published_at: r.created_at?.toISOString() || r.published_at?.toISOString() || new Date().toISOString(),
      word_count: Number(r.word_count || 0),
    };
  });

  const newPostsTs = rows[0]?.created_at?.toISOString() || new Date().toISOString();
  const followedDids = await getFollowedDids(session?.did ?? null);

  return c.html((
    <BlogsLayout title="blogs.social — Discover the open web" session={session}>
      <FeedPage items={items} page={page} newPostsTs={newPostsTs} session={session} followedDids={followedDids} />
    </BlogsLayout>
  ) as unknown as string);
});

// ── Count since (for live banner) ───────────────────────────────────────────
app.get('/api/count-since', async (c) => {
  const ts = c.req.query('ts');
  if (!ts) return c.json({ count: 0 });

  try {
    const { rows } = await db.query(
      `SELECT COUNT(*) AS count FROM site_standard_articles
       WHERE created_at > $1`,
      [ts]
    );
    return c.json({ count: Number(rows[0]?.count || 0) });
  } catch {
    return c.json({ count: 0 });
  }
});

// ── Static JS ───────────────────────────────────────────────────────────────
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const blogsJs = readFileSync(join(__dirname, 'public/blogs.js'), 'utf-8');
app.get('/js/blogs.js', (c) => {
  c.header('Content-Type', 'application/javascript; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=3600');
  return c.body(blogsJs);
});

// ── Stats page ─────────────────────────────────────────────────────────────
app.get('/stats', async (c) => {
  const session = await getBlogsSession(c);
  try {
    const stats = await getBlogStats();
    return c.html((
      <BlogsLayout title="Platform Stats — blogs.social" session={session}>
        <StatsPage stats={stats} />
      </BlogsLayout>
    ) as unknown as string);
  } catch (err) {
    logger.error({ err }, 'Stats page error');
    return c.text('Stats temporarily unavailable', 503);
  }
});

// ── Author profile ──────────────────────────────────────────────────────────
app.get('/author/:did', async (c) => {
  const session = await getBlogsSession(c);
  const did = c.req.param('did');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const perPage = 30;
  const offset = (page - 1) * perPage;

  // Fetch profile
  let profile: AuthorProfile = {
    did,
    handle: did,
    displayName: '',
    avatar: null,
    description: '',
    postCount: 0,
    sites: [],
  };

  try {
    const p = await getCachedProfile(did);
    profile.handle = p.handle || did;
    profile.displayName = p.displayName || '';
    profile.avatar = p.avatar || null;
    profile.description = p.description || '';
  } catch {}

  // Post count
  const { rows: countRows } = await db.query(
    'SELECT COUNT(*) AS count FROM site_standard_articles WHERE author_did = $1',
    [did]
  );
  profile.postCount = Number(countRows[0]?.count || 0);

  // Distinct sites
  const { rows: siteRows } = await db.query(
    `SELECT DISTINCT site FROM site_standard_articles
     WHERE author_did = $1 AND site IS NOT NULL
     LIMIT 10`,
    [did]
  );
  profile.sites = siteRows.map((r: any) => {
    try { return new URL(r.site).hostname.replace(/^www\./, ''); } catch { return r.site; }
  });

  // Posts
  const { rows: postRows } = await db.query(`
    SELECT
      s.uri, s.title, s.site, s.path, s.published_at, s.word_count,
      s.created_at,
    COALESCE(s.description, LEFT(COALESCE(s.raw_record->>'content', s.raw_record->>'textContent'), 600)) AS text_content,
      s.raw_record->'tags' AS tags_json
    FROM site_standard_articles s
    WHERE s.author_did = $1
    ORDER BY s.created_at DESC
    LIMIT $2 OFFSET $3
  `, [did, perPage, offset]);

  const posts: AuthorPost[] = postRows.map((r: any) => {
    const uriParts = r.uri.replace('at://', '').split('/');
    const rkey = uriParts[uriParts.length - 1];

    let tags: string[] = [];
    try {
      if (r.tags_json && Array.isArray(r.tags_json)) tags = r.tags_json;
    } catch {}

    return {
      uri: r.uri,
      rkey,
      title: r.title,
      text_content: r.text_content,
      site: r.site,
      path: r.path,
      tags,
      published_at: r.published_at?.toISOString() || new Date().toISOString(),
      word_count: Number(r.word_count || 0),
    };
  });

  const followedDids = await getFollowedDids(session?.did ?? null);

  return c.html((
    <BlogsLayout title={`${profile.displayName || profile.handle} — blogs.social`} session={session}>
      <AuthorPage profile={profile} posts={posts} page={page} session={session} followedDids={followedDids} />
    </BlogsLayout>
  ) as unknown as string);
});

// ── Single post reader ──────────────────────────────────────────────────────
app.get('/read/:did/:rkey', async (c) => {
  const session = await getBlogsSession(c);
  const did = c.req.param('did');
  const rkey = c.req.param('rkey');
  const uri = `at://${did}/site.standard.document/${rkey}`;

  const { rows } = await db.query(
    `SELECT s.uri, s.author_did, s.title, s.site, s.path, s.published_at,
            s.word_count,
            COALESCE(s.raw_record->>'content', s.raw_record->>'textContent') AS text_content,
            s.raw_record->'tags' AS tags_json
     FROM site_standard_articles s WHERE s.uri = $1`,
    [uri]
  );

  if (rows.length === 0) {
    return c.html((
      <BlogsLayout title="Not Found — blogs.social" session={session}>
        <div class="bl-feed">
          <div class="bl-empty">
            <h2>Post not found</h2>
            <p>This document may have been deleted or doesn't exist.</p>
            <p style="margin-top: 1rem;"><a href="/">← Back to feed</a></p>
          </div>
        </div>
      </BlogsLayout>
    ) as unknown as string, 404);
  }

  const post = rows[0];
  let profile = { handle: did, avatar: '', displayName: '' };
  try {
    const p = await getCachedProfile(did);
    profile = { handle: p.handle || did, avatar: p.avatar || '', displayName: p.displayName || '' };
  } catch {}

  const { renderContent, shouldShowTitle, safeHostname } = await import('./lib/contentRenderer.js');
  const renderedBody = renderContent(post.text_content || '');
  const showTitle = shouldShowTitle(post.title, post.text_content);

  const canonicalUrl = post.site && post.path
    ? `${post.site.replace(/\/$/, '')}${post.path.startsWith('/') ? '' : '/'}${post.path}`
    : post.site || null;

  let tags: string[] = [];
  try {
    if (post.tags_json && Array.isArray(post.tags_json)) tags = post.tags_json;
  } catch {}

  const followedDids = await getFollowedDids(session?.did ?? null);
  const showFollow = session && session.did !== did;
  const isFollowing = followedDids.has(did);

  const { html: h, raw } = await import('hono/html');
  return c.html((
    <BlogsLayout title={`${post.title || 'Post'} — blogs.social`} session={session}>
      {h`
        <div class="bl-feed" style="padding-top: 1.5rem; padding-bottom: 3rem;">
          <div class="bl-post-header" style="margin-bottom: 1rem;">
            ${profile.avatar
              ? h`<img class="bl-avatar" src="${profile.avatar}" alt="" style="width: 44px; height: 44px;" />`
              : h`<div class="bl-avatar-ph" style="width: 44px; height: 44px; font-size: 1rem;">${(profile.displayName || profile.handle || '?')[0].toUpperCase()}</div>`
            }
            <div class="bl-post-meta">
              <div>
                <a href="/author/${did}" class="bl-post-author" style="font-size: 0.9rem;">${profile.displayName || profile.handle}</a>
                ${profile.displayName ? h`<span class="bl-post-handle">@${profile.handle}</span>` : ''}
              </div>
              <div class="bl-post-time">${new Date(post.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · ${post.word_count || 0} words</div>
            </div>
            ${showFollow ? (
              isFollowing
                ? h`<form method="POST" action="/unfollow/${did}" style="margin-left:auto;flex-shrink:0">
                    <button type="submit" class="bl-btn-following"><span>Following</span></button>
                  </form>`
                : h`<form method="POST" action="/follow/${did}" style="margin-left:auto;flex-shrink:0">
                    <button type="submit" class="bl-btn-follow">Follow</button>
                  </form>`
            ) : ''}
          </div>

          ${showTitle ? h`<h1 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 1rem; line-height: 1.3;">${post.title}</h1>` : ''}

          <div class="bl-post-body" style="font-size: 0.92rem;">
            ${raw(renderedBody)}
          </div>

          <div class="bl-post-footer" style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border);">
            ${canonicalUrl ? h`<a href="${canonicalUrl}" class="bl-source" target="_blank">📎 ${safeHostname(canonicalUrl)}</a>` : ''}
            ${tags.slice(0, 5).map((tag: string) => h`<span class="bl-tag">${tag.length > 24 ? tag.substring(0, 24) + '…' : tag}</span>`)}
            <a href="/read/${did}/${rkey}/source" class="bl-source" style="margin-left: auto;">⟨/⟩ View Source</a>
            <a href="/" class="bl-read-more">← Back to feed</a>
          </div>
        </div>
      `}
    </BlogsLayout>
  ) as unknown as string);
});

// ── View Source ──────────────────────────────────────────────────────────────
app.get('/read/:did/:rkey/source', async (c) => {
  const did = c.req.param('did');
  const rkey = c.req.param('rkey');

  try {
    const result = await getCachedRecordMulti(
      did,
      ['site.standard.document'],
      rkey
    );
    if (!result) {
      return c.html(`<html><body style="background:#0a0a0c;color:white;font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh">
        <div style="text-align:center"><h1 style="font-size:4rem;opacity:0.15">404</h1><p style="opacity:0.4">Record not found</p><a href="/read/${did}/${rkey}" style="color:#6366f1">← Back to post</a></div>
      </body></html>`, 404);
    }
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>View Source — blogs.social</title>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
          <style>
            body { background: #0a0a0c; color: #e5e5e5; font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; padding: 0; margin: 0; line-height: 1.6; }
            .src-header { max-width: 800px; margin: 0 auto; padding: 1.25rem 1.5rem 0.75rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.06); }
            .src-header a { color: #6366f1; text-decoration: none; font-size: 0.82rem; }
            .src-header a:hover { color: #818cf8; }
            .src-title { font-size: 0.85rem; font-weight: 500; color: rgba(255,255,255,0.5); }
            .src-uri { font-size: 0.72rem; color: rgba(255,255,255,0.3); margin-top: 0.15rem; word-break: break-all; }
            pre { max-width: 800px; margin: 0 auto; padding: 1.5rem; white-space: pre-wrap; word-break: break-word; font-size: 13px; }
            .key { color: #81a1c1; }
            .string { color: #a3be8c; }
            .number { color: #b48ead; }
            .boolean { color: #d08770; }
            .null { color: #bf616a; }
          </style>
        </head>
        <body>
          <div class="src-header">
            <div>
              <div class="src-title">⟨/⟩ AT Protocol Record Source</div>
              <div class="src-uri">at://${did}/site.standard.document/${rkey}</div>
            </div>
            <a href="/read/${did}/${rkey}">← Back to post</a>
          </div>
          <pre>${JSON.stringify(result.record, null, 2)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
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

// ── Error handling ──────────────────────────────────────────────────────────
app.onError((err, c) => {
  logger.error({ err, path: c.req.path }, 'Blogs request error');
  return c.html(`<html><body style="background:#0a0a0c;color:white;font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh">
    <div style="text-align:center"><h1 style="font-size:4rem;opacity:0.15">500</h1><p style="opacity:0.4">Something went wrong</p><a href="/" style="color:#6366f1">← Back</a></div>
  </body></html>`, 500);
});

app.notFound((c) => {
  return c.html(`<html><body style="background:#0a0a0c;color:white;font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh">
    <div style="text-align:center"><h1 style="font-size:4rem;opacity:0.15">404</h1><p style="opacity:0.4">Not found</p><a href="/" style="color:#6366f1">← Back</a></div>
  </body></html>`, 404);
});

// ── Start ───────────────────────────────────────────────────────────────────
const BLOGS_PORT = Number(process.env.BLOGS_PORT) || 4800;

async function start() {
  await runMigrations();

  const server = serve({ fetch: app.fetch, port: BLOGS_PORT }, () => {
    logger.info({ port: BLOGS_PORT }, 'blogs.social server started');
  });

  // Attach WebSocket live feed
  attachLiveFeed(server);
}

start().catch((err) => {
  logger.error({ err }, 'blogs.social startup failed');
  process.exit(1);
});

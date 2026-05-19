import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getCachedProfile } from '../lib/pdsCache.js';
import { BlogsLayout } from './views/layout.js';
import { FeedPage, type FeedItem } from './views/feed.js';
import { AuthorPage, type AuthorProfile, type AuthorPost } from './views/author.js';
import { blogsAuthRouter, getBlogsSession } from './routes/auth.js';

const app = new Hono();

// ── Auth routes ─────────────────────────────────────────────────────────────
app.route('/', blogsAuthRouter);

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
      LEFT(s.raw_record->>'textContent', 2000) AS text_content,
      s.raw_record->'tags' AS tags_json
    FROM site_standard_articles s
    WHERE s.published_at IS NOT NULL
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
      published_at: r.published_at?.toISOString() || new Date().toISOString(),
      word_count: Number(r.word_count || 0),
    };
  });

  const newPostsTs = rows[0]?.created_at?.toISOString() || new Date().toISOString();

  return c.html((
    <BlogsLayout title="blogs.social — Discover the open web" session={session}>
      <FeedPage items={items} page={page} newPostsTs={newPostsTs} />
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
      LEFT(s.raw_record->>'textContent', 2000) AS text_content,
      s.raw_record->'tags' AS tags_json
    FROM site_standard_articles s
    WHERE s.author_did = $1
    ORDER BY s.published_at DESC NULLS LAST
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

  return c.html((
    <BlogsLayout title={`${profile.displayName || profile.handle} — blogs.social`} session={session}>
      <AuthorPage profile={profile} posts={posts} page={page} session={session} />
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
            s.word_count, s.raw_record->>'textContent' AS text_content,
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
          </div>

          ${showTitle ? h`<h1 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 1rem; line-height: 1.3;">${post.title}</h1>` : ''}

          <div class="bl-post-body" style="font-size: 0.92rem;">
            ${raw(renderedBody)}
          </div>

          <div class="bl-post-footer" style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border);">
            ${canonicalUrl ? h`<a href="${canonicalUrl}" class="bl-source" target="_blank">📎 ${safeHostname(canonicalUrl)}</a>` : ''}
            ${tags.map((tag: string) => h`<span class="bl-tag">${tag}</span>`)}
            <a href="/" class="bl-read-more" style="margin-left: auto;">← Back to feed</a>
          </div>
        </div>
      `}
    </BlogsLayout>
  ) as unknown as string);
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

  serve({ fetch: app.fetch, port: BLOGS_PORT }, () => {
    logger.info({ port: BLOGS_PORT }, 'blogs.social server started');
  });
}

start().catch((err) => {
  logger.error({ err }, 'blogs.social startup failed');
  process.exit(1);
});

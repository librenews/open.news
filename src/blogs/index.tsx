import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { getCachedProfile, getCachedProfiles, getCachedRecordMulti } from '../lib/pdsCache.js';
import { BlogsLayout } from './views/layout.js';
import { FeedPage, type FeedItem } from './views/feed.js';
import { AuthorPage, type AuthorProfile, type AuthorPost } from './views/author.js';
import { SubscriptionsPage, type SubscriptionItem } from './views/subscriptions.js';
import { StatsPage } from './views/stats.js';
import { getBlogStats, startStatsWarm } from './lib/statsCache.js';
import { blogsAuthRouter, getBlogsSession } from './routes/auth.js';
import { blogsFollowRouter } from './routes/follow.js';
import { blogsComposeRouter } from './routes/compose.js';
import { blogsInteractRouter } from './routes/interact.js';
import { attachLiveFeed } from './lib/liveFeed.js';
import { type TrendingTag, type PopularPost } from './views/feed.js';

const app = new Hono();

// ── Auth routes ─────────────────────────────────────────────────────────────
app.route('/', blogsAuthRouter);

// ── Follow routes ────────────────────────────────────────────────────────────
app.route('/', blogsFollowRouter);

// ── Compose routes ──────────────────────────────────────────────────────────
app.route('/', blogsComposeRouter);

// ── Interact routes (like/unlike/share/stats) ─────────────────────────────────
app.route('/', blogsInteractRouter);

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

// ── Helper: enrich session with avatar & displayName from PDS ────────────────
async function enrichSession(session: { did: string; handle: string } | null) {
  if (!session) return null;
  try {
    const p = await getCachedProfile(session.did);
    return { ...session, avatar: p.avatar || '', displayName: p.displayName || '' };
  } catch {
    return { ...session, avatar: '', displayName: '' };
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

// ── Publication verification (.well-known) ──────────────────────────────────
app.get('/.well-known/site.standard.publication', async (c) => {
  try {
    const { rows } = await db.query(
      "SELECT uri FROM site_publications WHERE url LIKE '%blogs.social%' ORDER BY created_at LIMIT 1"
    );
    if (rows.length > 0) {
      return c.text(rows[0].uri);
    }
  } catch {}
  return c.text('', 404);
});

// ── Pre-warm stats cache immediately, refresh every 5 minutes ────────────────
startStatsWarm();
setInterval(() => startStatsWarm(), 5 * 60 * 1000);

// ── Feed helpers ─────────────────────────────────────────────────────────────
async function buildFeedItems(rows: any[], sessionDid: string | null): Promise<FeedItem[]> {
  const uniqueDids = [...new Set(rows.map((r: any) => r.author_did))];
  const profileMap = await getCachedProfiles(uniqueDids);

  return rows.map((r: any) => {
    const rkey = r.uri.replace('at://', '').split('/').pop();
    const profile = profileMap.get(r.author_did) || { handle: r.author_did, avatar: '', displayName: '' };
    let tags: string[] = [];
    try { if (r.tags_json && Array.isArray(r.tags_json)) tags = r.tags_json; } catch {}
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
      like_count: Number(r.like_count || 0),
      share_count: Number(r.share_count || 0),
      user_liked: r.user_liked === true,
    };
  });
}

async function fetchSidebarData(): Promise<{ trendingTags: TrendingTag[]; popularPosts: PopularPost[] }> {
  const [tagRows, popRows] = await Promise.all([
    db.query(`
      SELECT tag, COUNT(*)::int AS cnt
      FROM site_standard_articles s,
           jsonb_array_elements_text(s.raw_record->'tags') AS tag
      WHERE s.published_at > NOW() - INTERVAL '7 days'
      GROUP BY tag ORDER BY cnt DESC LIMIT 20
    `),
    db.query(`
      SELECT s.uri, s.author_did, s.title, s.published_at,
        COUNT(CASE WHEN ai.interaction_type = 'like' THEN 1 END)::int AS like_count,
        COUNT(CASE WHEN ai.interaction_type IN ('share','repost') THEN 1 END)::int AS share_count,
        COUNT(*) * EXP(-EXTRACT(EPOCH FROM (NOW() - s.published_at)) / (7 * 86400)) AS decay_score
      FROM article_interactions ai
      JOIN site_standard_articles s ON s.uri = ai.article_uri
      WHERE s.published_at > NOW() - INTERVAL '30 days'
      GROUP BY s.uri, s.author_did, s.title, s.published_at
      HAVING COUNT(*) >= 1
      ORDER BY decay_score DESC LIMIT 6
    `),
  ]);

  const trendingTags: TrendingTag[] = tagRows.rows.map((r: any) => ({ tag: r.tag, count: r.cnt }));

  const popDids = [...new Set(popRows.rows.map((r: any) => r.author_did))];
  const popProfileMap = await getCachedProfiles(popDids);

  const popularPosts: PopularPost[] = popRows.rows.map((r: any) => ({
    uri: r.uri,
    rkey: r.uri.split('/').pop(),
    author_did: r.author_did,
    author_name: popProfileMap.get(r.author_did)?.displayName || r.author_did,
    author_handle: popProfileMap.get(r.author_did)?.handle || r.author_did,
    title: r.title,
    published_at: r.published_at?.toISOString() ?? '',
    like_count: r.like_count,
    share_count: r.share_count,
  }));

  return { trendingTags, popularPosts };
}

// ── Feed (Homepage) ─────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const session = await enrichSession(await getBlogsSession(c));
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const view = (c.req.query('view') === 'following' && session) ? 'following' : 'latest';
  const perPage = 30;
  const offset = (page - 1) * perPage;

  const followedDids = await getFollowedDids(session?.did ?? null);

  let rows: any[] = [];
  if (view === 'following') {
    if (followedDids.size === 0) {
      rows = [];
    } else {
      const didsArray = [...followedDids];
      const { rows: r } = await db.query(`
        SELECT * FROM (
          SELECT DISTINCT ON (s.author_did)
            s.uri, s.author_did, s.title, s.site, s.path,
            s.published_at, s.word_count, s.created_at,
            COALESCE(s.description, s.raw_record->>'content', s.raw_record->>'textContent') AS text_content,
            s.raw_record->'tags' AS tags_json,
            COALESCE(ai_counts.like_count, 0) AS like_count,
            COALESCE(ai_counts.share_count, 0) AS share_count,
            COALESCE(ul.user_liked, false) AS user_liked
          FROM site_standard_articles s
          LEFT JOIN LATERAL (
            SELECT
              COUNT(CASE WHEN interaction_type='like' THEN 1 END)::int AS like_count,
              COUNT(CASE WHEN interaction_type IN ('share','repost') THEN 1 END)::int AS share_count
            FROM article_interactions WHERE article_uri = s.uri
          ) ai_counts ON true
          LEFT JOIN LATERAL (
            SELECT COUNT(*) > 0 AS user_liked
            FROM article_interactions
            WHERE article_uri = s.uri AND actor_did = $3 AND interaction_type = 'like'
          ) ul ON true
          WHERE s.author_did = ANY($1)
          ORDER BY s.author_did, s.published_at DESC NULLS LAST
        ) sub
        ORDER BY published_at DESC NULLS LAST
        LIMIT $2
      `, [didsArray, perPage, session!.did]);
      rows = r;
    }
  } else {
    const { rows: r } = await db.query(`
      SELECT
        s.uri, s.author_did, s.title, s.site, s.path,
        s.published_at, s.word_count, s.created_at,
        COALESCE(s.description, s.raw_record->>'content', s.raw_record->>'textContent') AS text_content,
        s.raw_record->'tags' AS tags_json,
        COALESCE(ai_counts.like_count, 0) AS like_count,
        COALESCE(ai_counts.share_count, 0) AS share_count,
        COALESCE(ul.user_liked, false) AS user_liked
      FROM site_standard_articles s
      LEFT JOIN LATERAL (
        SELECT
          COUNT(CASE WHEN interaction_type='like' THEN 1 END)::int AS like_count,
          COUNT(CASE WHEN interaction_type IN ('share','repost') THEN 1 END)::int AS share_count
        FROM article_interactions WHERE article_uri = s.uri
      ) ai_counts ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) > 0 AS user_liked
        FROM article_interactions
        WHERE article_uri = s.uri AND actor_did = $3 AND interaction_type = 'like'
      ) ul ON true
      ORDER BY s.created_at DESC
      LIMIT $1 OFFSET $2
    `, [perPage, offset, session?.did ?? '']);
    rows = r;
  }

  const [items, { trendingTags, popularPosts }] = await Promise.all([
    buildFeedItems(rows, session?.did ?? null),
    fetchSidebarData(),
  ]);

  const newPostsTs = rows[0]?.created_at?.toISOString() || new Date().toISOString();

  return c.html((
    <BlogsLayout title="blogs.social — Discover the open web" session={session} navPage="home">
      <FeedPage
        items={items}
        page={page}
        newPostsTs={newPostsTs}
        session={session}
        followedDids={followedDids}
        view={view}
        trendingTags={trendingTags}
        popularPosts={popularPosts}
      />
    </BlogsLayout>
  ) as unknown as string);
});

// ── Tag page ─────────────────────────────────────────────────────────────────
app.get('/tag/:tag', async (c) => {
  const session = await enrichSession(await getBlogsSession(c));
  const tag = decodeURIComponent(c.req.param('tag'));
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const perPage = 30;
  const offset = (page - 1) * perPage;

  const { rows } = await db.query(`
    SELECT
      s.uri, s.author_did, s.title, s.site, s.path,
      s.published_at, s.word_count, s.created_at,
      COALESCE(s.description, s.raw_record->>'content', s.raw_record->>'textContent') AS text_content,
      s.raw_record->'tags' AS tags_json,
      COALESCE(ai_counts.like_count, 0) AS like_count,
      COALESCE(ai_counts.share_count, 0) AS share_count,
      COALESCE(ul.user_liked, false) AS user_liked
    FROM site_standard_articles s
    LEFT JOIN LATERAL (
      SELECT
        COUNT(CASE WHEN interaction_type='like' THEN 1 END)::int AS like_count,
        COUNT(CASE WHEN interaction_type IN ('share','repost') THEN 1 END)::int AS share_count
      FROM article_interactions WHERE article_uri = s.uri
    ) ai_counts ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) > 0 AS user_liked
      FROM article_interactions
      WHERE article_uri = s.uri AND actor_did = $3 AND interaction_type = 'like'
    ) ul ON true
    WHERE s.raw_record->'tags' ? $1
    ORDER BY s.published_at DESC NULLS LAST
    LIMIT $2 OFFSET $4
  `, [tag, perPage, session?.did ?? '', offset]);

  const [items, { trendingTags, popularPosts }, followedDids] = await Promise.all([
    buildFeedItems(rows, session?.did ?? null),
    fetchSidebarData(),
    getFollowedDids(session?.did ?? null),
  ]);

  return c.html((
    <BlogsLayout title={`#${tag} — blogs.social`} session={session}>
      <FeedPage
        items={items}
        page={page}
        newPostsTs={new Date().toISOString()}
        session={session}
        followedDids={followedDids}
        view="latest"
        trendingTags={trendingTags}
        popularPosts={popularPosts}
      />
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
  const session = await enrichSession(await getBlogsSession(c));
  try {
    const stats = await getBlogStats();
    return c.html((
      <BlogsLayout title="Platform Stats — blogs.social" session={session} navPage="stats">
        <StatsPage stats={stats} />
      </BlogsLayout>
    ) as unknown as string);
  } catch (err) {
    logger.error({ err }, 'Stats page error');
    return c.text('Stats temporarily unavailable', 503);
  }
});

// ── Subscriptions page ──────────────────────────────────────────────────────
app.get('/subscriptions', async (c) => {
  const session = await enrichSession(await getBlogsSession(c));
  if (!session) return c.redirect('/auth/login');

  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const perPage = 20;
  const offset = (page - 1) * perPage;

  // Total count
  const { rows: countRows } = await db.query(
    'SELECT COUNT(*)::int AS cnt FROM blogs_follows WHERE follower_did = $1',
    [session.did]
  );
  const totalCount = countRows[0]?.cnt || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

  // Fetch followed DIDs for this page
  const { rows: followRows } = await db.query(
    `SELECT following_did FROM blogs_follows
     WHERE follower_did = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [session.did, perPage, offset]
  );

  const followedDids = followRows.map((r: any) => r.following_did);

  // Batch-fetch profiles
  const profileMap = await getCachedProfiles(followedDids);

  // Batch-fetch post counts
  let postCounts: Record<string, number> = {};
  if (followedDids.length > 0) {
    const { rows: pcRows } = await db.query(
      `SELECT author_did, COUNT(*)::int AS cnt
       FROM site_standard_articles
       WHERE author_did = ANY($1)
       GROUP BY author_did`,
      [followedDids]
    );
    for (const r of pcRows) postCounts[r.author_did] = r.cnt;
  }

  const subs: SubscriptionItem[] = followedDids.map(did => {
    const p = profileMap.get(did);
    return {
      did,
      handle: p?.handle || did,
      displayName: p?.displayName || '',
      avatar: p?.avatar || '',
      postCount: postCounts[did] || 0,
    };
  });

  return c.html((
    <BlogsLayout title="Subscriptions — blogs.social" session={session} navPage="subscriptions">
      <SubscriptionsPage subs={subs} page={page} totalPages={totalPages} totalCount={totalCount} />
    </BlogsLayout>
  ) as unknown as string);
});

// ── Author post redirect: /author/:did/:rkey → /read/:did/:rkey ─────────────
app.get('/author/:did/:rkey', (c) => {
  const did = c.req.param('did');
  const rkey = c.req.param('rkey');
  return c.redirect(`/read/${did}/${rkey}`, 301);
});

// ── Author profile ──────────────────────────────────────────────────────────
app.get('/author/:did', async (c) => {
  const session = await enrichSession(await getBlogsSession(c));
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
    profile.description = (p as any).description || '';
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

  const { rows: postRows } = await db.query(`
    SELECT
      s.uri, s.title, s.site, s.path, s.published_at, s.word_count,
      s.created_at,
      COALESCE(s.description, s.raw_record->>'content', s.raw_record->>'textContent') AS text_content,
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
    <BlogsLayout title={`${profile.displayName || profile.handle} — blogs.social`} session={session} navPage="profile">
      <AuthorPage profile={profile} posts={posts} page={page} session={session} followedDids={followedDids} />
    </BlogsLayout>
  ) as unknown as string);
});

// ── Single post reader ──────────────────────────────────────────────────────
app.get('/read/:did/:rkey', async (c) => {
  const session = await enrichSession(await getBlogsSession(c));
  const did = c.req.param('did');
  const rkey = c.req.param('rkey');
  const uri = `at://${did}/site.standard.document/${rkey}`;

  const { rows } = await db.query(
    `SELECT s.uri, s.author_did, s.title, s.site, s.path, s.published_at,
            s.word_count,
            COALESCE(s.raw_record->>'content', s.raw_record->>'textContent') AS text_content,
            s.raw_record->'content' AS content_json,
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

  const { renderContent, shouldShowTitle, safeHostname, isLeafletContent, renderLeafletHtml } = await import('./lib/contentRenderer.js');
  let renderedBody: string;
  if (post.content_json && typeof post.content_json === 'object' && isLeafletContent(post.content_json)) {
    renderedBody = renderLeafletHtml(post.content_json, did);
  } else {
    renderedBody = renderContent(post.text_content || '');
  }
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
  const docLink = h`<link rel="site.standard.document" href="${uri}" />`;
  return c.html((
    <BlogsLayout title={`${post.title || 'Post'} — blogs.social`} session={session} headExtra={docLink}>
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

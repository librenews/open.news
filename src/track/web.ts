import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { sessionMiddleware, sessionRequired } from '../web/middleware/session.js';
import {
  createTrack, getTracksByUserId, getTrackById, getTrackByFeedToken,
  deleteTrack as dbDeleteTrack, updateTrackKeywords,
  getMatchesByTrackId, getMatchesByUserId, getMatchCountByTrack,
} from '../db/queries/tracks.js';
import { upsertTrackQuery, deleteTrackQuery } from './opensearch.js';
import { getUserById } from '../db/queries/users.js';

const TRACK_PORT = Number(process.env.TRACK_PORT ?? 4200);

type Env = { Variables: { userId: bigint } };
const app = new Hono<Env>();

// ─── Session ────────────────────────────────────────────────────────────────
app.use('*', sessionMiddleware as never);

// ─── Public: RSS feeds (UUID-obfuscated, no auth) ───────────────────────────

app.get('/rss/:token', async (c) => {
  const track = await getTrackByFeedToken(c.req.param('token'));
  if (!track) return c.text('Not found', 404);

  const matches = await getMatchesByTrackId(track.id, 100);
  return c.body(buildRss(track.name, matches), 200, {
    'Content-Type': 'application/rss+xml; charset=utf-8',
  });
});

// ─── Auth wall ──────────────────────────────────────────────────────────────

app.get('/login', (c) => {
  // Redirect to open.news OAuth login, which sets the session cookie
  return c.redirect(`${config.BASE_URL}/oauth/login?redirect=${encodeURIComponent(`http://localhost:${TRACK_PORT}/`)}`);
});

// All routes below require auth
app.use('/*', sessionRequired as never);

// ─── Dashboard ──────────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const userId = c.get('userId');
  const user = await getUserById(userId);
  const tracks = await getTracksByUserId(userId);
  const counts = await getMatchCountByTrack(userId);
  const countMap = new Map(counts.map((r) => [r.track_id, parseInt(r.count, 10)]));

  return c.html(renderPage('Dashboard', user?.handle ?? '', `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
      <h2 style="margin:0">Your Tracks</h2>
      <button onclick="document.getElementById('new-track-form').style.display='block'" class="btn">+ New Track</button>
    </div>

    <form id="new-track-form" method="POST" action="/tracks" style="display:none;margin-bottom:1.5rem;padding:1rem;background:var(--surface-2);border-radius:8px">
      <div style="margin-bottom:0.5rem">
        <label>Name</label>
        <input type="text" name="name" placeholder="e.g. PHP news" required style="width:100%">
      </div>
      <div style="margin-bottom:0.5rem">
        <label>Keywords (comma-separated)</label>
        <input type="text" name="keywords" placeholder="PHP, Laravel, Symfony" required style="width:100%">
      </div>
      <button type="submit" class="btn btn-primary">Create Track</button>
    </form>

    ${tracks.length === 0 ? '<p style="color:var(--text-muted)">No tracks yet. Create one to start monitoring Bluesky posts.</p>' : ''}

    <div class="track-list">
      ${tracks.map((t) => `
        <div class="track-card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <a href="/tracks/${t.id}" style="font-weight:600;font-size:1.1rem;text-decoration:none">${escHtml(t.name)}</a>
            <span class="badge">${countMap.get(String(t.id)) ?? 0} matches</span>
          </div>
          <div style="margin-top:0.4rem;color:var(--text-muted);font-size:0.9rem">
            Keywords: ${t.keywords.map((k) => `<code>${escHtml(k)}</code>`).join(', ')}
          </div>
          <div style="margin-top:0.4rem;font-size:0.8rem;display:flex;gap:1rem">
            <a href="/rss/${t.feed_token}" target="_blank">RSS Feed</a>
            <form method="POST" action="/tracks/${t.id}/delete" style="display:inline">
              <button type="submit" class="btn-ghost" style="color:var(--text-danger);font-size:0.8rem" onclick="return confirm('Delete this track?')">Delete</button>
            </form>
          </div>
        </div>
      `).join('')}
    </div>
  `));
});

// ─── Track CRUD ─────────────────────────────────────────────────────────────

app.post('/tracks', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.parseBody();
  const name = String(body.name ?? '').trim();
  const keywordsRaw = String(body.keywords ?? '').trim();

  if (!name || !keywordsRaw) return c.redirect('/');

  const keywords = keywordsRaw.split(',').map((k) => k.trim()).filter(Boolean);
  if (keywords.length === 0) return c.redirect('/');

  const osQueryId = await upsertTrackQuery(0, keywords); // temp ID
  const track = await createTrack(userId, name, keywords, '');
  // Now update with real ID
  const realOsId = await upsertTrackQuery(track.id, keywords);
  await updateTrackKeywords(track.id, keywords, realOsId);

  return c.redirect('/');
});

app.post('/tracks/:id/delete', async (c) => {
  const userId = c.get('userId');
  const trackId = parseInt(c.req.param('id'), 10);
  const track = await getTrackById(trackId);
  if (!track || track.user_id !== userId) return c.text('Not found', 404);

  await deleteTrackQuery(track.id);
  await dbDeleteTrack(track.id);
  return c.redirect('/');
});

// ─── Track Feed ─────────────────────────────────────────────────────────────

app.get('/tracks/:id', async (c) => {
  const userId = c.get('userId');
  const trackId = parseInt(c.req.param('id'), 10);
  const track = await getTrackById(trackId);
  if (!track || track.user_id !== userId) return c.text('Not found', 404);

  const user = await getUserById(userId);
  const before = c.req.query('before');
  const matches = await getMatchesByTrackId(track.id, 50, before);

  return c.html(renderPage(track.name, user?.handle ?? '', `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
      <div>
        <a href="/" style="font-size:0.9rem">← Back</a>
        <h2 style="margin:0.3rem 0 0">${escHtml(track.name)}</h2>
        <div style="color:var(--text-muted);font-size:0.9rem">Keywords: ${track.keywords.map((k) => `<code>${escHtml(k)}</code>`).join(', ')}</div>
      </div>
      <a href="/rss/${track.feed_token}" class="btn btn-ghost" target="_blank">RSS</a>
    </div>
    ${renderMatches(matches)}
    ${matches.length === 50 ? `<a href="/tracks/${track.id}?before=${matches[matches.length - 1].matched_at.toISOString()}" class="btn btn-ghost" style="width:100%;text-align:center;margin-top:1rem">Load more</a>` : ''}
  `));
});

app.get('/feed', async (c) => {
  const userId = c.get('userId');
  const user = await getUserById(userId);
  const before = c.req.query('before');
  const matches = await getMatchesByUserId(userId, 50, before);

  return c.html(renderPage('All Matches', user?.handle ?? '', `
    <h2>All Matches</h2>
    ${renderMatches(matches)}
    ${matches.length === 50 ? `<a href="/feed?before=${matches[matches.length - 1].matched_at.toISOString()}" class="btn btn-ghost" style="width:100%;text-align:center;margin-top:1rem">Load more</a>` : ''}
  `));
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface MatchRow {
  post_uri: string;
  post_did: string;
  post_text: string;
  matched_at: Date;
  track_name?: string;
}

function renderMatches(matches: MatchRow[]): string {
  if (matches.length === 0) return '<p style="color:var(--text-muted)">No matches yet.</p>';
  return `<div class="match-list">${matches.map((m) => {
    const bskyUrl = m.post_uri.replace('at://', 'https://bsky.app/profile/').replace('/app.bsky.feed.post/', '/post/');
    const ago = timeAgo(m.matched_at);
    return `
      <div class="match-card">
        <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.3rem">
          ${m.track_name ? `<span class="badge-sm">${escHtml(m.track_name)}</span> · ` : ''}
          <a href="https://bsky.app/profile/${m.post_did}" target="_blank" style="color:var(--text-muted)">${m.post_did.slice(0, 20)}…</a> · ${ago}
        </div>
        <div style="font-size:0.95rem;line-height:1.4">${escHtml(m.post_text)}</div>
        <a href="${bskyUrl}" target="_blank" style="font-size:0.8rem;margin-top:0.3rem;display:inline-block">View on Bluesky →</a>
      </div>`;
  }).join('')}</div>`;
}

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function buildRss(title: string, matches: MatchRow[]): string {
  const items = matches.map((m) => {
    const bskyUrl = m.post_uri.replace('at://', 'https://bsky.app/profile/').replace('/app.bsky.feed.post/', '/post/');
    return `<item>
      <title>${escHtml(m.post_text.slice(0, 100))}</title>
      <link>${bskyUrl}</link>
      <description>${escHtml(m.post_text)}</description>
      <pubDate>${m.matched_at.toUTCString()}</pubDate>
      <guid>${m.post_uri}</guid>
    </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Track: ${escHtml(title)}</title>
    <description>Bluesky posts matching "${escHtml(title)}"</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;
}

function renderPage(title: string, handle: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)} — Track</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0f0f13; --surface: #1a1a23; --surface-2: #23232f;
      --text: #e4e4ed; --text-muted: #8888a0;
      --text-danger: #ff6b6b;
      --primary: #6366f1; --primary-hover: #818cf8;
      --border: #2a2a3a; --radius: 8px;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); max-width: 720px; margin: 0 auto; padding: 0 1rem 2rem; }
    a { color: var(--primary); }
    a:hover { color: var(--primary-hover); }
    code { background: var(--surface-2); padding: 2px 6px; border-radius: 4px; font-size: 0.85em; }
    nav { display: flex; justify-content: space-between; align-items: center; padding: 1rem 0; border-bottom: 1px solid var(--border); margin-bottom: 1.5rem; }
    nav a { text-decoration: none; }
    .btn { display: inline-block; padding: 0.5rem 1rem; background: var(--primary); color: #fff; border: none; border-radius: var(--radius); cursor: pointer; text-decoration: none; font-size: 0.9rem; }
    .btn:hover { background: var(--primary-hover); }
    .btn-primary { background: var(--primary); }
    .btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--text-muted); }
    .btn-ghost:hover { border-color: var(--primary); color: var(--primary); }
    input, select { background: var(--surface); color: var(--text); border: 1px solid var(--border); padding: 0.5rem; border-radius: var(--radius); font-size: 0.9rem; }
    input:focus { outline: 1px solid var(--primary); border-color: var(--primary); }
    label { display: block; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.3rem; }
    .track-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .track-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; }
    .match-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .match-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.75rem 1rem; }
    .badge { background: var(--surface-2); color: var(--text-muted); font-size: 0.8rem; padding: 2px 8px; border-radius: 12px; }
    .badge-sm { background: var(--primary); color: #fff; font-size: 0.75rem; padding: 1px 6px; border-radius: 8px; }
  </style>
</head>
<body>
  <nav>
    <a href="/" style="font-weight:600;font-size:1.1rem">📡 Track</a>
    <div style="display:flex;gap:1rem;align-items:center">
      <a href="/feed">All Matches</a>
      <span style="color:var(--text-muted);font-size:0.85rem">@${escHtml(handle)}</span>
    </div>
  </nav>
  ${content}
</body>
</html>`;
}

// ─── Start ──────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: TRACK_PORT }, () => {
  logger.info({ port: TRACK_PORT }, 'Track web server started');
});

import { html, raw } from 'hono/html';
import type { VideoItem } from './feed.js';

/**
 * Self-contained embed player for oEmbed.
 * Rendered inside an iframe — no nav, no external deps, all CSS inline.
 */
export function EmbedPage({
  items,
  title,
}: {
  items: VideoItem[];
  title: string;
}) {
  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Build JSON data for the client-side player
  const playerData = items.map((item) => ({
    did: item.did,
    cid: item.cid || null,
    source_url: item.source_url,
    thumbnail_cid: item.thumbnail_cid || null,
    post_text: item.post_text || item.alt_text || 'Video clip',
    author_handle: item.author_handle,
    author_display_name: item.author_display_name || item.author_handle,
    author_avatar: item.author_avatar || null,
    duration_ms: item.duration_ms || null,
    like_count: item.like_count || 0,
    uri: item.uri,
  }));

  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%; height: 100%;
      overflow: hidden;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #020617;
      color: #f8fafc;
      -webkit-font-smoothing: antialiased;
    }

    .embed-container {
      display: flex;
      flex-direction: column;
      height: 100vh;
      width: 100%;
    }

    /* ── Video Player Area ──────────────────────────── */
    .player-area {
      position: relative;
      width: 100%;
      flex-shrink: 0;
      background: #000;
    }
    .player-area video {
      display: block;
      width: 100%;
      max-height: 56vh;
      object-fit: contain;
      background: #000;
    }

    /* ── Now Playing Bar ────────────────────────────── */
    .now-playing {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 12px;
      background: rgba(15, 23, 42, 0.95);
      border-bottom: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
      min-height: 44px;
    }
    .now-playing-info {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
    }
    .now-playing-avatar {
      width: 28px; height: 28px;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.08);
      flex-shrink: 0;
      object-fit: cover;
    }
    .now-playing-avatar-placeholder {
      width: 28px; height: 28px;
      border-radius: 50%;
      background: #1e293b;
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 700; color: #64748b;
    }
    .now-playing-text {
      min-width: 0;
    }
    .now-playing-title {
      font-size: 12px;
      font-weight: 600;
      color: #e2e8f0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 280px;
    }
    .now-playing-author {
      font-size: 10px;
      color: #64748b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ── Playlist Controls ──────────────────────────── */
    .controls {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .controls button {
      background: rgba(99, 102, 241, 0.15);
      border: 1px solid rgba(99, 102, 241, 0.25);
      color: #a5b4fc;
      width: 28px; height: 28px;
      border-radius: 8px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px;
      transition: all 0.15s ease;
    }
    .controls button:hover:not(:disabled) {
      background: rgba(99, 102, 241, 0.3);
      border-color: rgba(99, 102, 241, 0.5);
      color: #c7d2fe;
    }
    .controls button:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .track-indicator {
      font-size: 10px;
      font-weight: 600;
      color: #64748b;
      min-width: 36px;
      text-align: center;
    }

    /* ── Playlist ───────────────────────────────────── */
    .playlist {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      background: #0f172a;
    }
    .playlist::-webkit-scrollbar { width: 4px; }
    .playlist::-webkit-scrollbar-track { background: transparent; }
    .playlist::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 4px; }

    .playlist-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      cursor: pointer;
      transition: background 0.15s ease;
      border-bottom: 1px solid rgba(255,255,255,0.03);
      position: relative;
    }
    .playlist-item:hover {
      background: rgba(30, 41, 59, 0.6);
    }
    .playlist-item.active {
      background: rgba(99, 102, 241, 0.1);
      border-left: 3px solid #6366f1;
    }
    .playlist-item.active .pl-index {
      color: #6366f1;
    }
    .pl-index {
      font-size: 10px;
      font-weight: 700;
      color: #475569;
      width: 16px;
      text-align: center;
      flex-shrink: 0;
    }
    .pl-thumb {
      width: 56px; height: 32px;
      border-radius: 4px;
      object-fit: cover;
      background: #1e293b;
      flex-shrink: 0;
    }
    .pl-thumb-placeholder {
      width: 56px; height: 32px;
      border-radius: 4px;
      background: #1e293b;
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      color: #475569;
      font-size: 14px;
    }
    .pl-info {
      min-width: 0;
      flex: 1;
    }
    .pl-title {
      font-size: 11px;
      font-weight: 500;
      color: #cbd5e1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pl-author {
      font-size: 10px;
      color: #475569;
    }
    .pl-duration {
      font-size: 10px;
      color: #475569;
      flex-shrink: 0;
    }

    /* ── Branding Footer ───────────────────────────── */
    .branding {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      background: rgba(15, 23, 42, 0.95);
      border-top: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
    }
    .branding-link {
      font-size: 10px;
      font-weight: 600;
      color: #64748b;
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: color 0.15s ease;
    }
    .branding-link:hover {
      color: #a5b4fc;
    }
    .branding-logo {
      font-weight: 800;
      background: linear-gradient(135deg, #818cf8, #a78bfa, #f472b6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-size: 11px;
    }

    /* ── Single video mode (no playlist) ───────────── */
    .embed-container.single .playlist { display: none; }
    .embed-container.single .player-area video { max-height: 80vh; }
    .embed-container.single .now-playing { border-bottom: none; }

    /* ── Empty state ───────────────────────────────── */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      color: #475569;
      font-size: 13px;
      gap: 8px;
    }
    .empty-state span { font-size: 28px; }
  </style>
</head>
<body>
  ${items.length === 0
    ? html`<div class="empty-state"><span>🔇</span><div>No videos found</div></div>`
    : html`
  <div class="embed-container${items.length === 1 ? ' single' : ''}" id="embed">
    <!-- Video Player -->
    <div class="player-area">
      <video id="player" controls playsinline preload="metadata"></video>
    </div>

    <!-- Now Playing Bar -->
    <div class="now-playing">
      <div class="now-playing-info">
        <div id="np-avatar"></div>
        <div class="now-playing-text">
          <div class="now-playing-title" id="np-title"></div>
          <div class="now-playing-author" id="np-author"></div>
        </div>
      </div>
      ${items.length > 1 ? html`
      <div class="controls">
        <button id="btn-prev" title="Previous" aria-label="Previous video">◀</button>
        <span class="track-indicator" id="track-indicator"></span>
        <button id="btn-next" title="Next" aria-label="Next video">▶</button>
      </div>
      ` : ''}
    </div>

    <!-- Playlist -->
    ${items.length > 1 ? html`
    <div class="playlist" id="playlist"></div>
    ` : ''}

    <!-- Branding -->
    <div class="branding">
      <a href="https://snip.social" target="_blank" rel="noopener" class="branding-link">
        Powered by <span class="branding-logo">snip.</span>
      </a>
      <a href="https://snip.social" target="_blank" rel="noopener" class="branding-link">
        Open in Snip ↗
      </a>
    </div>
  </div>

  <script>
    (function() {
      var items = ${raw(JSON.stringify(playerData))};
      var current = 0;
      var player = document.getElementById('player');
      var npTitle = document.getElementById('np-title');
      var npAuthor = document.getElementById('np-author');
      var npAvatar = document.getElementById('np-avatar');
      var btnPrev = document.getElementById('btn-prev');
      var btnNext = document.getElementById('btn-next');
      var trackInd = document.getElementById('track-indicator');
      var playlistEl = document.getElementById('playlist');

      function getVideoSrc(item) {
        if (item.cid && item.did) return '/video/proxy/' + encodeURIComponent(item.did) + '/' + encodeURIComponent(item.cid);
        return item.source_url;
      }

      function getPosterUrl(item) {
        if (!item.thumbnail_cid || !item.did) return '';
        if (item.thumbnail_cid.indexOf('http') === 0) return item.thumbnail_cid;
        return 'https://bsky.social/xrpc/com.atproto.sync.getBlob?did=' + encodeURIComponent(item.did) + '&cid=' + encodeURIComponent(item.thumbnail_cid);
      }

      function formatDuration(ms) {
        if (!ms) return '';
        var s = Math.round(ms / 1000);
        var m = Math.floor(s / 60);
        s = s % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
      }

      function loadTrack(index, autoplay) {
        if (index < 0 || index >= items.length) return;
        current = index;
        var item = items[current];

        // Update player
        player.src = getVideoSrc(item);
        player.poster = getPosterUrl(item);
        if (autoplay) {
          player.play().catch(function() {});
        }

        // Update now playing
        npTitle.textContent = item.post_text;
        npAuthor.textContent = '@' + item.author_handle;

        if (item.author_avatar) {
          npAvatar.innerHTML = '<img class="now-playing-avatar" src="' + item.author_avatar + '" alt="" />';
        } else {
          npAvatar.innerHTML = '<div class="now-playing-avatar-placeholder">?</div>';
        }

        // Update controls
        if (btnPrev) btnPrev.disabled = current === 0;
        if (btnNext) btnNext.disabled = current === items.length - 1;
        if (trackInd) trackInd.textContent = (current + 1) + ' / ' + items.length;

        // Update playlist active state
        if (playlistEl) {
          var allItems = playlistEl.querySelectorAll('.playlist-item');
          allItems.forEach(function(el, i) {
            el.classList.toggle('active', i === current);
          });
          // Scroll active into view
          if (allItems[current]) {
            allItems[current].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }

      // Build playlist DOM
      if (playlistEl && items.length > 1) {
        items.forEach(function(item, i) {
          var div = document.createElement('div');
          div.className = 'playlist-item' + (i === 0 ? ' active' : '');
          div.setAttribute('data-index', i);

          var poster = getPosterUrl(item);
          var thumbHtml = poster
            ? '<img class="pl-thumb" src="' + poster + '" alt="" loading="lazy" />'
            : '<div class="pl-thumb-placeholder">▶</div>';

          div.innerHTML =
            '<span class="pl-index">' + (i + 1) + '</span>' +
            thumbHtml +
            '<div class="pl-info">' +
              '<div class="pl-title">' + item.post_text.replace(/</g, '&lt;') + '</div>' +
              '<div class="pl-author">@' + item.author_handle.replace(/</g, '&lt;') + '</div>' +
            '</div>' +
            '<span class="pl-duration">' + formatDuration(item.duration_ms) + '</span>';

          div.addEventListener('click', function() {
            loadTrack(i, true);
          });
          playlistEl.appendChild(div);
        });
      }

      // Event listeners
      if (btnPrev) btnPrev.addEventListener('click', function() { loadTrack(current - 1, true); });
      if (btnNext) btnNext.addEventListener('click', function() { loadTrack(current + 1, true); });

      // Auto-advance on ended
      player.addEventListener('ended', function() {
        if (current < items.length - 1) {
          loadTrack(current + 1, true);
        }
      });

      // Load first track
      loadTrack(0, false);
    })();
  </script>
  `}
</body>
</html>`;
}

import { html, raw } from 'hono/html';
import type { BlogStats } from '../lib/statsCache.js';

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function pct(a: number, b: number): string {
  if (!b) return '0%';
  return Math.round((a / b) * 100) + '%';
}

export function StatsPage({ stats }: { stats: BlogStats }) {
  const updatedAt = new Date(stats.updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

  // Verification rate (of checked posts only)
  const checkedTotal = stats.totalVerified + stats.totalUnverified;
  const verificationRate = checkedTotal > 0
    ? ((stats.totalVerified / checkedTotal * 100) < 1
        ? (stats.totalVerified / checkedTotal * 100).toFixed(1) + '%'
        : Math.round(stats.totalVerified / checkedTotal * 100) + '%')
    : '—';

  // Average retention across 14-day window (native-only — bridgyfed aggregators post daily and inflate to 100%)
  const retDaysNative = stats.retention.filter(d => d.retained_native + d.churned_native > 0);
  const avgRetentionNative = retDaysNative.length > 0
    ? Math.round(retDaysNative.reduce((sum, d) => sum + d.retained_native / (d.retained_native + d.churned_native), 0) / retDaysNative.length * 100) + '%'
    : '—';
  const retDaysBridgy = stats.retention.filter(d => d.retained_bridgyfed + d.churned_bridgyfed > 0);
  const avgRetentionBridgy = retDaysBridgy.length > 0
    ? Math.round(retDaysBridgy.reduce((sum, d) => sum + d.retained_bridgyfed / (d.retained_bridgyfed + d.churned_bridgyfed), 0) / retDaysBridgy.length * 100) + '%'
    : '—';

  // Serialize data for Chart.js
  const waaJson = JSON.stringify(stats.waaTrend);
  const dailyJson = JSON.stringify(stats.dailyActivity);
  const retJson = JSON.stringify(stats.retention);
  const heatmapJson = JSON.stringify(stats.hourlyHeatmap);
  const topSitesJson = JSON.stringify(stats.topSites);
  const topSitesNativeJson = JSON.stringify(stats.topSitesNative);
  const topSitesBridgyfedJson = JSON.stringify(stats.topSitesBridgyfed);
  const topSitesVerifiedJson = JSON.stringify(stats.topSitesVerified);
  const langJson = JSON.stringify(stats.languages);
  const langNativeJson = JSON.stringify(stats.languagesNative);
  const langBridgyfedJson = JSON.stringify(stats.languagesBridgyfed);
  const langVerifiedJson = JSON.stringify(stats.languagesVerified);
  const newAuthJson = JSON.stringify(stats.newAuthors);

  return html`
    <div class="bl-stats">
      <!-- Header -->
      <div class="bl-stats-hero">
        <h1>blogs.social · Platform Stats</h1>
        <p class="bl-stats-updated">Updated ${updatedAt} · refreshes every 5 min</p>
      </div>

      <!-- KPI Cards -->
      <div class="bl-kpi-grid">
        <div class="bl-kpi-card">
          <div class="bl-kpi-value">${fmt(stats.waa)}</div>
          <div class="bl-kpi-label">Weekly Active Authors</div>
          <div class="bl-kpi-sub">rolling 7 days</div>
          <div class="bl-kpi-split bl-kpi-split-wrap">
            <span class="bl-kpi-native">🌐 ${fmt(stats.waa_native)} native</span>
            <span class="bl-kpi-bridgy">🌉 ${fmt(stats.waa_bridgyfed)} bridgyfed</span>
            <span class="bl-kpi-verified">✅ ${fmt(stats.waa_verified)} verified</span>
          </div>
        </div>
        <div class="bl-kpi-card">
          <div class="bl-kpi-value">${fmt(stats.daa)}</div>
          <div class="bl-kpi-label">Daily Active Authors</div>
          <div class="bl-kpi-sub">yesterday</div>
          <div class="bl-kpi-split bl-kpi-split-wrap">
            <span class="bl-kpi-native">🌐 ${fmt(stats.daa_native)} native</span>
            <span class="bl-kpi-bridgy">🌉 ${fmt(stats.daa_bridgyfed)} bridgyfed</span>
            <span class="bl-kpi-verified">✅ ${fmt(stats.daa_verified)} verified</span>
          </div>
        </div>
        <div class="bl-kpi-card">
          <div class="bl-kpi-value">${fmt(stats.postsYesterday)}</div>
          <div class="bl-kpi-label">Posts Yesterday</div>
          <div class="bl-kpi-sub">${(stats.postsYesterday / Math.max(stats.daa, 1)).toFixed(1)} per author</div>
          <div class="bl-kpi-split bl-kpi-split-wrap">
            <span class="bl-kpi-native">🌐 ${fmt(stats.posts_native)} native</span>
            <span class="bl-kpi-bridgy">🌉 ${fmt(stats.posts_bridgyfed)} bridgyfed</span>
            <span class="bl-kpi-verified">✅ ${fmt(stats.posts_verified)} verified</span>
          </div>
        </div>
        <div class="bl-kpi-card">
          <div class="bl-kpi-value">${fmt(stats.totalAuthors)}</div>
          <div class="bl-kpi-label">Total Authors</div>
          <div class="bl-kpi-sub">all time</div>
          <div class="bl-kpi-split bl-kpi-split-wrap">
            <span class="bl-kpi-native">🌐 ${fmt(stats.totalAuthors_native)} native</span>
            <span class="bl-kpi-bridgy">🌉 ${fmt(stats.totalAuthors_bridgyfed)} bridgyfed</span>
            <span class="bl-kpi-verified">✅ ${fmt(stats.totalAuthors_verified)} verified</span>
          </div>
        </div>
        <div class="bl-kpi-card">
          <div class="bl-kpi-value">${fmt(stats.totalPosts)}</div>
          <div class="bl-kpi-label">Total Posts</div>
          <div class="bl-kpi-sub">all time</div>
          <div class="bl-kpi-split bl-kpi-split-wrap">
            <span class="bl-kpi-native">🌐 ${fmt(stats.totalPosts_native)} native</span>
            <span class="bl-kpi-bridgy">🌉 ${fmt(stats.totalPosts_bridgyfed)} bridgyfed</span>
            <span class="bl-kpi-verified">✅ ${fmt(stats.totalPosts_verified)} verified</span>
          </div>
        </div>
        <div class="bl-kpi-card">
          <div class="bl-kpi-value">${avgRetentionNative}</div>
          <div class="bl-kpi-label">Day-over-Day Retention</div>
          <div class="bl-kpi-sub">14-day avg · native only</div>
          <div class="bl-kpi-split">
            <span class="bl-kpi-bridgy">🌉 ${avgRetentionBridgy} bridgyfed</span>
          </div>
        </div>
        <div class="bl-kpi-card">
          <div class="bl-kpi-value">${verificationRate}</div>
          <div class="bl-kpi-label">Verification Rate</div>
          <div class="bl-kpi-sub">standard.site verified</div>
          <div class="bl-kpi-split bl-kpi-split-wrap">
            <span class="bl-kpi-verified">✅ ${fmt(stats.totalVerified)} verified</span>
            <span class="bl-kpi-bridgy">❌ ${fmt(stats.totalUnverified)} unverified</span>
            <span class="bl-kpi-unchecked">⏳ ${fmt(stats.totalUnchecked)} unchecked</span>
          </div>
        </div>
      </div>

      <!-- Charts grid -->
      <div class="bl-charts-grid">

        <!-- WAA Trend -->
        <div class="bl-chart-card bl-chart-wide">
          <div class="bl-chart-header">
            <div>
              <div class="bl-chart-title">Weekly Active Authors — 30 Day Trend</div>
              <div class="bl-chart-sub">Rolling 7-day unique authors</div>
            </div>
            <div class="bl-toggle" data-target="waa">
              <button class="bl-toggle-btn active" data-mode="all">All</button>
              <button class="bl-toggle-btn" data-mode="native">Native</button>
              <button class="bl-toggle-btn" data-mode="bridgyfed">BridgyFed</button>
              <button class="bl-toggle-btn" data-mode="verified">Verified</button>
            </div>
          </div>
          <canvas id="waaChart" height="80"></canvas>
        </div>

        <!-- Daily Activity -->
        <div class="bl-chart-card bl-chart-wide">
          <div class="bl-chart-header">
            <div>
              <div class="bl-chart-title">Daily Posts & Authors</div>
              <div class="bl-chart-sub">Last 30 days</div>
            </div>
            <div class="bl-toggle" data-target="daily">
              <button class="bl-toggle-btn active" data-mode="all">All</button>
              <button class="bl-toggle-btn" data-mode="native">Native</button>
              <button class="bl-toggle-btn" data-mode="bridgyfed">BridgyFed</button>
              <button class="bl-toggle-btn" data-mode="verified">Verified</button>
            </div>
          </div>
          <canvas id="dailyChart" height="80"></canvas>
        </div>

        <!-- Retention stacked bar -->
        <div class="bl-chart-card">
          <div class="bl-chart-header">
            <div>
              <div class="bl-chart-title">Author Retention</div>
              <div class="bl-chart-sub">New · Retained · Churned — 14 days</div>
            </div>
            <div class="bl-toggle" data-target="retention">
              <button class="bl-toggle-btn active" data-mode="all">All</button>
              <button class="bl-toggle-btn" data-mode="native">Native</button>
              <button class="bl-toggle-btn" data-mode="bridgyfed">BridgyFed</button>
              <button class="bl-toggle-btn" data-mode="verified">Verified</button>
            </div>
          </div>
          <canvas id="retentionChart" height="140"></canvas>
        </div>

        <!-- New authors per day -->
        <div class="bl-chart-card">
          <div class="bl-chart-header">
            <div>
              <div class="bl-chart-title">New Authors Per Day</div>
              <div class="bl-chart-sub">First-time publishers — 30 days</div>
            </div>
            <div class="bl-toggle" data-target="newauth">
              <button class="bl-toggle-btn active" data-mode="all">All</button>
              <button class="bl-toggle-btn" data-mode="native">Native</button>
              <button class="bl-toggle-btn" data-mode="bridgyfed">BridgyFed</button>
              <button class="bl-toggle-btn" data-mode="verified">Verified</button>
            </div>
          </div>
          <canvas id="newAuthChart" height="140"></canvas>
        </div>

        <!-- Heatmap -->
        <div class="bl-chart-card bl-chart-wide">
          <div class="bl-chart-header">
            <div>
              <div class="bl-chart-title">Hourly Activity Heatmap</div>
              <div class="bl-chart-sub">Posts by day of week × hour (UTC) — last 7 days</div>
            </div>
            <div class="bl-toggle" data-target="heatmap">
              <button class="bl-toggle-btn active" data-mode="all">All</button>
              <button class="bl-toggle-btn" data-mode="native">Native</button>
              <button class="bl-toggle-btn" data-mode="bridgyfed">BridgyFed</button>
              <button class="bl-toggle-btn" data-mode="verified">Verified</button>
            </div>
          </div>
          <div id="heatmap" class="bl-heatmap"></div>
        </div>

        <!-- Top Sites -->
        <div class="bl-chart-card">
          <div class="bl-chart-header">
            <div>
              <div class="bl-chart-title">Top Publishing Sites</div>
              <div class="bl-chart-sub">By post count — this week</div>
            </div>
            <div class="bl-toggle" data-target="sites">
              <button class="bl-toggle-btn active" data-mode="all">All</button>
              <button class="bl-toggle-btn" data-mode="native">Native</button>
              <button class="bl-toggle-btn" data-mode="bridgyfed">BridgyFed</button>
              <button class="bl-toggle-btn" data-mode="verified">Verified</button>
            </div>
          </div>
          <canvas id="sitesChart" height="220"></canvas>
        </div>

        <!-- Language distribution -->
        <div class="bl-chart-card">
          <div class="bl-chart-header">
            <div>
              <div class="bl-chart-title">Language Distribution</div>
              <div class="bl-chart-sub">Last 30 days</div>
            </div>
            <div class="bl-toggle" data-target="lang">
              <button class="bl-toggle-btn active" data-mode="all">All</button>
              <button class="bl-toggle-btn" data-mode="native">Native</button>
              <button class="bl-toggle-btn" data-mode="bridgyfed">BridgyFed</button>
              <button class="bl-toggle-btn" data-mode="verified">Verified</button>
            </div>
          </div>
          <canvas id="langChart" height="220"></canvas>
        </div>

      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
    <script>
      const WAA_DATA    = ${raw(waaJson)};
      const DAILY_DATA  = ${raw(dailyJson)};
      const RET_DATA    = ${raw(retJson)};
      const HEAT_DATA   = ${raw(heatmapJson)};
      const SITES_DATA  = ${raw(topSitesJson)};
      const SITES_NATIVE = ${raw(topSitesNativeJson)};
      const SITES_BRIDGY = ${raw(topSitesBridgyfedJson)};
      const SITES_VERIFIED = ${raw(topSitesVerifiedJson)};
      const LANG_DATA   = ${raw(langJson)};
      const LANG_NATIVE = ${raw(langNativeJson)};
      const LANG_BRIDGY = ${raw(langBridgyfedJson)};
      const LANG_VERIFIED = ${raw(langVerifiedJson)};
      const NEWAUTH_DATA = ${raw(newAuthJson)};

      const ACCENT    = '#6366f1';
      const GREEN     = '#10b981';
      const AMBER     = '#f59e0b';
      const RED       = '#ef4444';
      const VERIFIED  = '#22d3ee';
      const MUTED     = 'rgba(255,255,255,0.12)';
      const TEXT      = 'rgba(255,255,255,0.7)';
      const GRID      = 'rgba(255,255,255,0.05)';

      Chart.defaults.color = TEXT;
      Chart.defaults.borderColor = GRID;
      Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
      Chart.defaults.font.size = 11;

      // ── Toggle handler ──────────────────────────────────────
      document.querySelectorAll('.bl-toggle').forEach(function(toggle) {
        toggle.querySelectorAll('.bl-toggle-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            toggle.querySelectorAll('.bl-toggle-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var target = toggle.dataset.target;
            var mode = btn.dataset.mode;
            if (target === 'waa') updateWaa(mode);
            if (target === 'daily') updateDaily(mode);
            if (target === 'retention') updateRetention(mode);
            if (target === 'newauth') updateNewAuth(mode);
            if (target === 'heatmap') renderHeatmap(mode);
            if (target === 'sites') updateSites(mode);
            if (target === 'lang') updateLang(mode);
          });
        });
      });

      // ── WAA Trend (togglable) ──────────────────────────────
      var waaChart = new Chart(document.getElementById('waaChart'), {
        type: 'line',
        data: {
          labels: WAA_DATA.map(d => d.day.slice(5)),
          datasets: [
            {
              label: 'Total',
              data: WAA_DATA.map(d => d.waa),
              borderColor: ACCENT,
              backgroundColor: 'rgba(99,102,241,0.08)',
              fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2,
            },
            {
              label: 'Native',
              data: WAA_DATA.map(d => d.waa_native),
              borderColor: AMBER, backgroundColor: 'transparent',
              tension: 0.4, pointRadius: 1, pointHoverRadius: 4, borderWidth: 1.5, borderDash: [4, 2],
            },
            {
              label: 'BridgyFed',
              data: WAA_DATA.map(d => d.waa_bridgyfed),
              borderColor: GREEN, backgroundColor: 'transparent',
              tension: 0.4, pointRadius: 1, pointHoverRadius: 4, borderWidth: 1.5, borderDash: [4, 2],
            },
            {
              label: 'Verified',
              data: WAA_DATA.map(d => d.waa_verified),
              borderColor: VERIFIED, backgroundColor: 'transparent',
              tension: 0.4, pointRadius: 1, pointHoverRadius: 4, borderWidth: 1.5, borderDash: [2, 2],
            }
          ]
        },
        options: {
          responsive: true, interaction: { mode: 'index' },
          plugins: { legend: { labels: { boxWidth: 12 } } },
          scales: { x: { grid: { color: GRID } }, y: { grid: { color: GRID }, beginAtZero: false } }
        }
      });
      function updateWaa(mode) {
        var show = { all: [true,true,true,true], native: [false,true,false,false], bridgyfed: [false,false,true,false], verified: [false,false,false,true] };
        var vis = show[mode] || show.all;
        waaChart.data.datasets.forEach(function(ds, i) { ds.hidden = !vis[i]; });
        waaChart.update();
      }

      // ── Daily Activity (togglable) ──────────────────────────
      var dailyChart = new Chart(document.getElementById('dailyChart'), {
        type: 'bar',
        data: {
          labels: DAILY_DATA.map(d => d.day.slice(5)),
          datasets: [
            { label: 'Posts (Native)', data: DAILY_DATA.map(d => d.posts_native), backgroundColor: 'rgba(99,102,241,0.55)', stack: 'posts', yAxisID: 'y', order: 3 },
            { label: 'Posts (BridgyFed)', data: DAILY_DATA.map(d => d.posts_bridgyfed), backgroundColor: 'rgba(16,185,129,0.45)', stack: 'posts', yAxisID: 'y', order: 3 },
            { label: 'Authors (Native)', data: DAILY_DATA.map(d => d.authors_native), type: 'line', borderColor: AMBER, backgroundColor: 'transparent', tension: 0.3, pointRadius: 1, borderWidth: 1.5, yAxisID: 'y1', order: 1 },
            { label: 'Authors (BridgyFed)', data: DAILY_DATA.map(d => d.authors_bridgyfed), type: 'line', borderColor: GREEN, backgroundColor: 'transparent', tension: 0.3, pointRadius: 1, borderWidth: 1.5, borderDash: [4, 2], yAxisID: 'y1', order: 1 }
          ]
        },
        options: {
          responsive: true, interaction: { mode: 'index' },
          plugins: { legend: { labels: { boxWidth: 12 } } },
          scales: {
            x: { grid: { color: GRID }, stacked: true },
            y: { grid: { color: GRID }, position: 'left', stacked: true, title: { display: true, text: 'Posts' } },
            y1: { grid: { display: false }, position: 'right', title: { display: true, text: 'Authors' } }
          }
        }
      });
      function updateDaily(mode) {
        if (mode === 'verified') {
          dailyChart.data.datasets[0].data = DAILY_DATA.map(d => d.posts_verified);
          dailyChart.data.datasets[0].backgroundColor = 'rgba(34,211,238,0.55)';
          dailyChart.data.datasets[0].label = 'Posts (Verified)';
          dailyChart.data.datasets[1].data = DAILY_DATA.map(d => 0);
          dailyChart.data.datasets[1].backgroundColor = 'transparent';
          dailyChart.data.datasets[2].data = DAILY_DATA.map(d => d.authors_verified);
          dailyChart.data.datasets[2].borderColor = VERIFIED;
          dailyChart.data.datasets[2].label = 'Authors (Verified)';
          dailyChart.data.datasets[3].data = DAILY_DATA.map(d => 0);
        } else if (mode === 'native') {
          dailyChart.data.datasets[0].data = DAILY_DATA.map(d => d.posts_native);
          dailyChart.data.datasets[0].backgroundColor = 'rgba(245,158,11,0.55)';
          dailyChart.data.datasets[0].label = 'Posts (Native)';
          dailyChart.data.datasets[1].data = DAILY_DATA.map(d => 0);
          dailyChart.data.datasets[1].backgroundColor = 'transparent';
          dailyChart.data.datasets[2].data = DAILY_DATA.map(d => d.authors_native);
          dailyChart.data.datasets[2].borderColor = AMBER;
          dailyChart.data.datasets[2].label = 'Authors (Native)';
          dailyChart.data.datasets[3].data = DAILY_DATA.map(d => 0);
        } else if (mode === 'bridgyfed') {
          dailyChart.data.datasets[0].data = DAILY_DATA.map(d => d.posts_bridgyfed);
          dailyChart.data.datasets[0].backgroundColor = 'rgba(16,185,129,0.55)';
          dailyChart.data.datasets[0].label = 'Posts (BridgyFed)';
          dailyChart.data.datasets[1].data = DAILY_DATA.map(d => 0);
          dailyChart.data.datasets[1].backgroundColor = 'transparent';
          dailyChart.data.datasets[2].data = DAILY_DATA.map(d => d.authors_bridgyfed);
          dailyChart.data.datasets[2].borderColor = GREEN;
          dailyChart.data.datasets[2].label = 'Authors (BridgyFed)';
          dailyChart.data.datasets[3].data = DAILY_DATA.map(d => 0);
        } else {
          dailyChart.data.datasets[0].data = DAILY_DATA.map(d => d.posts_native);
          dailyChart.data.datasets[0].backgroundColor = 'rgba(99,102,241,0.55)';
          dailyChart.data.datasets[0].label = 'Posts (Native)';
          dailyChart.data.datasets[1].data = DAILY_DATA.map(d => d.posts_bridgyfed);
          dailyChart.data.datasets[1].backgroundColor = 'rgba(16,185,129,0.45)';
          dailyChart.data.datasets[2].data = DAILY_DATA.map(d => d.authors_native);
          dailyChart.data.datasets[2].borderColor = AMBER;
          dailyChart.data.datasets[2].label = 'Authors (Native)';
          dailyChart.data.datasets[3].data = DAILY_DATA.map(d => d.authors_bridgyfed);
        }
        dailyChart.update();
      }

      // ── Retention stacked bar (togglable) ───────────────────
      var retChart = new Chart(document.getElementById('retentionChart'), {
        type: 'bar',
        data: {
          labels: RET_DATA.map(d => d.day.slice(5)),
          datasets: [
            { label: 'Retained', data: RET_DATA.map(d => d.retained), backgroundColor: GREEN, stack: 'a' },
            { label: 'New',      data: RET_DATA.map(d => d.new_authors), backgroundColor: ACCENT, stack: 'a' },
            { label: 'Churned',  data: RET_DATA.map(d => -d.churned), backgroundColor: RED, stack: 'b' },
          ]
        },
        options: {
          responsive: true, interaction: { mode: 'index' },
          plugins: { legend: { labels: { boxWidth: 12 } } },
          scales: { x: { grid: { color: GRID }, stacked: true }, y: { grid: { color: GRID }, stacked: true } }
        }
      });
      function updateRetention(mode) {
        var r = mode === 'native'
          ? { ret: 'retained_native', nw: 'new_native', ch: 'churned_native' }
          : mode === 'bridgyfed'
          ? { ret: 'retained_bridgyfed', nw: 'new_bridgyfed', ch: 'churned_bridgyfed' }
          : mode === 'verified'
          ? { ret: 'retained_verified', nw: 'new_verified', ch: 'churned_verified' }
          : { ret: 'retained', nw: 'new_authors', ch: 'churned' };
        retChart.data.datasets[0].data = RET_DATA.map(d => d[r.ret]);
        retChart.data.datasets[1].data = RET_DATA.map(d => d[r.nw]);
        retChart.data.datasets[2].data = RET_DATA.map(d => -d[r.ch]);
        retChart.update();
      }

      // ── New Authors (togglable) ─────────────────────────────
      var newAuthChart = new Chart(document.getElementById('newAuthChart'), {
        type: 'bar',
        data: {
          labels: NEWAUTH_DATA.map(d => d.day.slice(5)),
          datasets: [
            { label: 'Native', data: NEWAUTH_DATA.map(d => d.new_native), backgroundColor: 'rgba(245,158,11,0.6)', stack: 'a' },
            { label: 'BridgyFed', data: NEWAUTH_DATA.map(d => d.new_bridgyfed), backgroundColor: 'rgba(16,185,129,0.6)', stack: 'a' },
            { label: 'Verified', data: NEWAUTH_DATA.map(d => d.new_verified), backgroundColor: 'rgba(34,211,238,0.6)', stack: 'a', hidden: true }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { boxWidth: 12 } } },
          scales: { x: { grid: { color: GRID }, stacked: true }, y: { grid: { color: GRID }, beginAtZero: true, stacked: true } }
        }
      });
      function updateNewAuth(mode) {
        if (mode === 'verified') {
          newAuthChart.data.datasets[0].hidden = true;
          newAuthChart.data.datasets[1].hidden = true;
          newAuthChart.data.datasets[2].hidden = false;
        } else if (mode === 'native') {
          newAuthChart.data.datasets[0].hidden = false;
          newAuthChart.data.datasets[1].hidden = true;
          newAuthChart.data.datasets[2].hidden = true;
        } else if (mode === 'bridgyfed') {
          newAuthChart.data.datasets[0].hidden = true;
          newAuthChart.data.datasets[1].hidden = false;
          newAuthChart.data.datasets[2].hidden = true;
        } else {
          newAuthChart.data.datasets[0].hidden = false;
          newAuthChart.data.datasets[1].hidden = false;
          newAuthChart.data.datasets[2].hidden = true;
        }
        newAuthChart.update();
      }

      // ── Heatmap (togglable) ─────────────────────────────────
      function renderHeatmap(mode) {
        var DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        var field = mode === 'native' ? 'posts_native' : mode === 'bridgyfed' ? 'posts_bridgyfed' : mode === 'verified' ? 'posts_verified' : 'posts';
        var map = {}, maxVal = 0;
        HEAT_DATA.forEach(function(d) {
          var v = d[field];
          map[d.dow + '_' + d.hour] = v;
          if (v > maxVal) maxVal = v;
        });
        var el = document.getElementById('heatmap');
        var h = '<div class="bl-heatmap-inner">';
        h += '<div class="bl-hm-row"><div class="bl-hm-label"></div>';
        for (var hr = 0; hr < 24; hr++) { h += '<div class="bl-hm-hlabel">' + (hr % 6 === 0 ? hr + 'h' : '') + '</div>'; }
        h += '</div>';
        for (var dow = 0; dow < 7; dow++) {
          h += '<div class="bl-hm-row"><div class="bl-hm-label">' + DAYS[dow] + '</div>';
          for (var hour = 0; hour < 24; hour++) {
            var v = map[dow + '_' + hour] || 0;
            var a = maxVal ? (0.08 + (v / maxVal) * 0.88).toFixed(2) : '0.08';
            var color = mode === 'bridgyfed' ? '16,185,129' : mode === 'native' ? '245,158,11' : mode === 'verified' ? '34,211,238' : '99,102,241';
            h += '<div class="bl-hm-cell" style="background:rgba(' + color + ',' + a + ')" title="' + DAYS[dow] + ' ' + hour + 'h: ' + v.toLocaleString() + ' posts"></div>';
          }
          h += '</div>';
        }
        h += '</div>';
        el.innerHTML = h;
      }
      renderHeatmap('all');

      // ── Top Sites horizontal bar (togglable) ────────────────
      var sitesChart = new Chart(document.getElementById('sitesChart'), {
        type: 'bar',
        data: {
          labels: SITES_DATA.map(d => d.site.length > 30 ? d.site.slice(0,28)+'…' : d.site),
          datasets: [{ data: SITES_DATA.map(d => d.posts), backgroundColor: 'rgba(99,102,241,0.6)', borderRadius: 4 }]
        },
        options: {
          indexAxis: 'y', responsive: true,
          plugins: { legend: { display: false } },
          scales: { x: { grid: { color: GRID } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } }
        }
      });
      function updateSites(mode) {
        var src = mode === 'native' ? SITES_NATIVE : mode === 'bridgyfed' ? SITES_BRIDGY : mode === 'verified' ? SITES_VERIFIED : SITES_DATA;
        var color = mode === 'bridgyfed' ? 'rgba(16,185,129,0.6)' : mode === 'native' ? 'rgba(245,158,11,0.6)' : mode === 'verified' ? 'rgba(34,211,238,0.6)' : 'rgba(99,102,241,0.6)';
        sitesChart.data.labels = src.map(d => d.site.length > 30 ? d.site.slice(0,28)+'…' : d.site);
        sitesChart.data.datasets[0].data = src.map(d => d.posts);
        sitesChart.data.datasets[0].backgroundColor = color;
        sitesChart.update();
      }

      // ── Language donut (togglable) ──────────────────────────
      var LANG_COLORS = [
        '#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6',
        '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6','#a78bfa','#64748b'
      ];
      var langChart = new Chart(document.getElementById('langChart'), {
        type: 'doughnut',
        data: {
          labels: LANG_DATA.map(d => d.language),
          datasets: [{ data: LANG_DATA.map(d => d.count), backgroundColor: LANG_COLORS, borderWidth: 0, hoverOffset: 6 }]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } }
        }
      });
      function updateLang(mode) {
        var src = mode === 'native' ? LANG_NATIVE : mode === 'bridgyfed' ? LANG_BRIDGY : mode === 'verified' ? LANG_VERIFIED : LANG_DATA;
        langChart.data.labels = src.map(d => d.language);
        langChart.data.datasets[0].data = src.map(d => d.count);
        langChart.update();
      }

      // Auto-refresh every 5 minutes
      setTimeout(() => window.location.reload(), 5 * 60 * 1000);
    </script>
  `;
}

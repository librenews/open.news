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
  const retTotal = stats.retention.at(-1);
  const retentionRate = retTotal ? pct(retTotal.retained, retTotal.retained + retTotal.churned) : '—';

  // Serialize data for Chart.js
  const waaJson = JSON.stringify(stats.waaTrend);
  const dailyJson = JSON.stringify(stats.dailyActivity);
  const retJson = JSON.stringify(stats.retention);
  const heatmapJson = JSON.stringify(stats.hourlyHeatmap);
  const topSitesJson = JSON.stringify(stats.topSites);
  const langJson = JSON.stringify(stats.languages);
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
        </div>
        <div class="bl-kpi-card">
          <div class="bl-kpi-value">${fmt(stats.daa)}</div>
          <div class="bl-kpi-label">Daily Active Authors</div>
          <div class="bl-kpi-sub">yesterday</div>
        </div>
        <div class="bl-kpi-card">
          <div class="bl-kpi-value">${fmt(stats.postsYesterday)}</div>
          <div class="bl-kpi-label">Posts Yesterday</div>
          <div class="bl-kpi-sub">${(stats.postsYesterday / Math.max(stats.daa, 1)).toFixed(1)} per author</div>
        </div>
        <div class="bl-kpi-card">
          <div class="bl-kpi-value">${fmt(stats.totalAuthors)}</div>
          <div class="bl-kpi-label">Total Authors</div>
          <div class="bl-kpi-sub">all time</div>
        </div>
        <div class="bl-kpi-card">
          <div class="bl-kpi-value">${fmt(stats.totalPosts)}</div>
          <div class="bl-kpi-label">Total Posts</div>
          <div class="bl-kpi-sub">all time</div>
        </div>
        <div class="bl-kpi-card">
          <div class="bl-kpi-value">${retentionRate}</div>
          <div class="bl-kpi-label">Day-over-Day Retention</div>
          <div class="bl-kpi-sub">authors returning daily</div>
        </div>
      </div>

      <!-- BridgyFed Split -->
      <div class="bl-bridgyfed-split">
        <div class="bl-bf-label">Yesterday breakdown</div>
        <div class="bl-bf-grid">
          <div class="bl-bf-card bl-bf-native">
            <div class="bl-bf-title">🌐 Native AT Protocol</div>
            <div class="bl-bf-row"><span class="bl-bf-num">${fmt(stats.daa_native)}</span><span class="bl-bf-sub">authors</span></div>
            <div class="bl-bf-row"><span class="bl-bf-num">${fmt(stats.posts_native)}</span><span class="bl-bf-sub">posts</span></div>
          </div>
          <div class="bl-bf-card bl-bf-bridgyfed">
            <div class="bl-bf-title">🌉 BridgyFed (Fediverse)</div>
            <div class="bl-bf-row"><span class="bl-bf-num">${fmt(stats.daa_bridgyfed)}</span><span class="bl-bf-sub">authors</span></div>
            <div class="bl-bf-row"><span class="bl-bf-num">${fmt(stats.posts_bridgyfed)}</span><span class="bl-bf-sub">posts</span></div>
          </div>
          <div class="bl-bf-card bl-bf-waa">
            <div class="bl-bf-title">📅 Weekly (7-day)</div>
            <div class="bl-bf-row"><span class="bl-bf-num">${fmt(stats.waa_native)}</span><span class="bl-bf-sub">native authors</span></div>
            <div class="bl-bf-row"><span class="bl-bf-num">${fmt(stats.waa_bridgyfed)}</span><span class="bl-bf-sub">bridgyfed authors</span></div>
          </div>
        </div>
      </div>

      <!-- Charts grid -->
      <div class="bl-charts-grid">

        <!-- WAA Trend -->
        <div class="bl-chart-card bl-chart-wide">
          <div class="bl-chart-title">Weekly Active Authors — 30 Day Trend</div>
          <div class="bl-chart-sub">Rolling 7-day unique authors</div>
          <canvas id="waaChart" height="80"></canvas>
        </div>

        <!-- Daily Activity -->
        <div class="bl-chart-card bl-chart-wide">
          <div class="bl-chart-title">Daily Posts & Authors</div>
          <div class="bl-chart-sub">Last 30 days</div>
          <canvas id="dailyChart" height="80"></canvas>
        </div>

        <!-- Retention stacked bar -->
        <div class="bl-chart-card">
          <div class="bl-chart-title">Author Retention</div>
          <div class="bl-chart-sub">New · Retained · Churned — 14 days</div>
          <canvas id="retentionChart" height="140"></canvas>
        </div>

        <!-- New authors per day -->
        <div class="bl-chart-card">
          <div class="bl-chart-title">New Authors Per Day</div>
          <div class="bl-chart-sub">First-time publishers — 30 days</div>
          <canvas id="newAuthChart" height="140"></canvas>
        </div>

        <!-- Heatmap -->
        <div class="bl-chart-card bl-chart-wide">
          <div class="bl-chart-title">Hourly Activity Heatmap</div>
          <div class="bl-chart-sub">Posts by day of week × hour (UTC) — last 7 days</div>
          <div id="heatmap" class="bl-heatmap"></div>
        </div>

        <!-- Top Sites -->
        <div class="bl-chart-card">
          <div class="bl-chart-title">Top Publishing Sites</div>
          <div class="bl-chart-sub">By post count — this week</div>
          <canvas id="sitesChart" height="220"></canvas>
        </div>

        <!-- Language distribution -->
        <div class="bl-chart-card">
          <div class="bl-chart-title">Language Distribution</div>
          <div class="bl-chart-sub">Last 30 days</div>
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
      const LANG_DATA   = ${raw(langJson)};
      const NEWAUTH_DATA = ${raw(newAuthJson)};

      const ACCENT  = '#6366f1';
      const GREEN   = '#10b981';
      const AMBER   = '#f59e0b';
      const RED     = '#ef4444';
      const MUTED   = 'rgba(255,255,255,0.12)';
      const TEXT    = 'rgba(255,255,255,0.7)';
      const GRID    = 'rgba(255,255,255,0.05)';

      Chart.defaults.color = TEXT;
      Chart.defaults.borderColor = GRID;
      Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
      Chart.defaults.font.size = 11;

      // ── WAA Trend ──────────────────────────────────────────
      new Chart(document.getElementById('waaChart'), {
        type: 'line',
        data: {
          labels: WAA_DATA.map(d => d.day.slice(5)),
          datasets: [{
            label: 'Weekly Active Authors',
            data: WAA_DATA.map(d => d.waa),
            borderColor: ACCENT,
            backgroundColor: 'rgba(99,102,241,0.08)',
            fill: true,
            tension: 0.4,
            pointRadius: 2,
            pointHoverRadius: 5,
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: GRID } },
            y: { grid: { color: GRID }, beginAtZero: false }
          }
        }
      });

      // ── Daily Activity ─────────────────────────────────────
      new Chart(document.getElementById('dailyChart'), {
        type: 'bar',
        data: {
          labels: DAILY_DATA.map(d => d.day.slice(5)),
          datasets: [
            {
              label: 'Posts',
              data: DAILY_DATA.map(d => d.posts),
              backgroundColor: 'rgba(99,102,241,0.55)',
              yAxisID: 'y',
              order: 2,
            },
            {
              label: 'Authors',
              data: DAILY_DATA.map(d => d.authors),
              type: 'line',
              borderColor: GREEN,
              backgroundColor: 'transparent',
              tension: 0.3,
              pointRadius: 2,
              yAxisID: 'y1',
              order: 1,
            }
          ]
        },
        options: {
          responsive: true,
          interaction: { mode: 'index' },
          plugins: { legend: { labels: { boxWidth: 12 } } },
          scales: {
            x: { grid: { color: GRID } },
            y: { grid: { color: GRID }, position: 'left', title: { display: true, text: 'Posts' } },
            y1: { grid: { display: false }, position: 'right', title: { display: true, text: 'Authors' } }
          }
        }
      });

      // ── Retention stacked bar ──────────────────────────────
      new Chart(document.getElementById('retentionChart'), {
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
          responsive: true,
          interaction: { mode: 'index' },
          plugins: { legend: { labels: { boxWidth: 12 } } },
          scales: {
            x: { grid: { color: GRID }, stacked: true },
            y: { grid: { color: GRID }, stacked: true }
          }
        }
      });

      // ── New Authors ────────────────────────────────────────
      new Chart(document.getElementById('newAuthChart'), {
        type: 'bar',
        data: {
          labels: NEWAUTH_DATA.map(d => d.day.slice(5)),
          datasets: [{
            label: 'New Authors',
            data: NEWAUTH_DATA.map(d => d.new_authors),
            backgroundColor: 'rgba(16,185,129,0.6)',
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: GRID } },
            y: { grid: { color: GRID }, beginAtZero: true }
          }
        }
      });

      // ── Heatmap ────────────────────────────────────────────
      (function() {
        const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const map = {};
        let maxVal = 0;
        HEAT_DATA.forEach(d => {
          const key = d.dow + '_' + d.hour;
          map[key] = d.posts;
          if (d.posts > maxVal) maxVal = d.posts;
        });

        const el = document.getElementById('heatmap');
        let html = '<div class="bl-heatmap-inner">';
        // Hour labels row
        html += '<div class="bl-hm-row"><div class="bl-hm-label"></div>';
        for (let h = 0; h < 24; h++) {
          html += '<div class="bl-hm-hlabel">' + (h % 6 === 0 ? h + 'h' : '') + '</div>';
        }
        html += '</div>';
        for (let dow = 0; dow < 7; dow++) {
          html += '<div class="bl-hm-row"><div class="bl-hm-label">' + DAYS[dow] + '</div>';
          for (let hour = 0; hour < 24; hour++) {
            const v = map[dow + '_' + hour] || 0;
            const intensity = maxVal ? v / maxVal : 0;
            const alpha = (0.08 + intensity * 0.88).toFixed(2);
            html += '<div class="bl-hm-cell" style="background:rgba(99,102,241,' + alpha + ')" title="' + DAYS[dow] + ' ' + hour + 'h: ' + v.toLocaleString() + ' posts"></div>';
          }
          html += '</div>';
        }
        html += '</div>';
        el.innerHTML = html;
      })();

      // ── Top Sites horizontal bar ───────────────────────────
      new Chart(document.getElementById('sitesChart'), {
        type: 'bar',
        data: {
          labels: SITES_DATA.map(d => d.site.length > 30 ? d.site.slice(0,28)+'…' : d.site),
          datasets: [{
            data: SITES_DATA.map(d => d.posts),
            backgroundColor: 'rgba(99,102,241,0.6)',
            borderRadius: 4,
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: GRID } },
            y: { grid: { display: false }, ticks: { font: { size: 10 } } }
          }
        }
      });

      // ── Language donut ─────────────────────────────────────
      const LANG_COLORS = [
        '#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6',
        '#06b6d4','#f97316','#84cc16','#ec4899','#14b8a6','#a78bfa','#64748b'
      ];
      new Chart(document.getElementById('langChart'), {
        type: 'doughnut',
        data: {
          labels: LANG_DATA.map(d => d.language),
          datasets: [{
            data: LANG_DATA.map(d => d.count),
            backgroundColor: LANG_COLORS,
            borderWidth: 0,
            hoverOffset: 6,
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } }
          }
        }
      });

      // Auto-refresh every 5 minutes
      setTimeout(() => window.location.reload(), 5 * 60 * 1000);
    </script>
  `;
}

import { html } from 'hono/html';

interface CityData {
  place_id: string;
  name: string;
  place_type: string;
  parent_name: string | null;
  article_count: number;
  account_count: number;
}

export function LandingPage({ cities }: { cities: CityData[] }) {
  return html`
    <div style="max-width: 800px; margin: 0 auto; padding: 3rem 1.5rem;">
      <div style="text-align: center; margin-bottom: 3rem;">
        <h1 style="font-size: 2.5rem; font-weight: 700; letter-spacing: -0.03em; margin-bottom: 0.75rem;">
          What's happening<br/><span style="color: var(--accent);">near you</span>
        </h1>
        <p style="color: var(--text-muted); font-size: 1rem; max-width: 480px; margin: 0 auto;">
          Local news and conversations from Bluesky and the open social web, organized by location.
        </p>
      </div>

      <h2 style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); margin-bottom: 1rem;">
        Browse locations with coverage
      </h2>

      <div class="nb-city-grid">
        ${cities.map(city => html`
          <a href="/city/${city.place_id}" class="nb-city-tile">
            <div class="name">${city.name}</div>
            <div class="stats">
              ${city.article_count.toLocaleString()} articles · ${city.account_count} accounts
            </div>
            ${city.parent_name ? html`<div class="country">${city.parent_name}</div>` : ''}
          </a>
        `)}
      </div>

      <div style="text-align: center; margin-top: 3rem; padding: 2rem; border-top: 1px solid var(--border);">
        <p style="font-size: 0.82rem; color: var(--text-dim);">
          Powered by the <a href="https://atproto.com" style="color: var(--text-muted);">AT Protocol</a> ·
          Built by <a href="https://bsky.app/profile/nearby.at" style="color: var(--text-muted);">@nearby.at</a>
        </p>
      </div>
    </div>
  `;
}

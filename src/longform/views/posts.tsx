import { html } from 'hono/html';
import { LeafletDocument } from '../../weblog/lexicons.js';

export function PostsPage(records: { uri: string, cid: string, value: LeafletDocument }[], did: string) {
  return html`
    <div style="margin-top: 2rem;">
      <h1 style="font-family: var(--font-sans); letter-spacing: -0.03em; margin-bottom: 2rem;">My Posts</h1>
      
      ${records.length === 0 ? html`<p style="color: var(--text-muted)">No posts published yet.</p>` : ''}
      
      <div style="display: flex; flex-direction: column; gap: 1.5rem;">
        ${records.map(r => {
          const rkey = r.uri.split('/').pop();
          const date = new Date(r.value.publishedAt || Date.now());
          const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          
          return html`
            <a href="/post/${did}/${rkey}" style="text-decoration: none; color: inherit; display: block; border-bottom: 1px solid rgba(0,0,0,0.1); padding-bottom: 1.5rem; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'">
              <h2 style="font-family: var(--font-sans); margin: 0 0 0.5rem 0; font-size: 22px;">${r.value.title}</h2>
              <span style="color: var(--text-muted); font-size: 14px; font-family: var(--font-sans);">${formattedDate}</span>
            </a>
          `;
        })}
      </div>
    </div>
  `;
}

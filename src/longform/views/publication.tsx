import { html } from 'hono/html';

interface PublicationArticle {
  uri: string;
  title: string;
  description: string | null;
  publishedAt: string | null;
  authorDid: string;
  authorHandle: string;
  authorAvatar: string;
  authorName: string;
  wordCount: number;
  rkey: string;
}

interface PublicationPageProps {
  publication: {
    uri: string;
    title: string;
    description: string;
    url: string | null;
    authorDid: string;
    authorHandle: string;
    authorAvatar: string;
    authorName: string;
    createdAt: string | null;
    collection: string;
    rkey: string;
  };
  articles: PublicationArticle[];
  domain: string;
}

export function PublicationPage({ publication, articles, domain }: PublicationPageProps) {
  return html`
    <style>
      .pub-container {
        max-width: 680px;
        margin: 0 auto;
        padding: 2rem 1rem;
      }
      .pub-header {
        margin-bottom: 2.5rem;
        padding-bottom: 2rem;
        border-bottom: 1px solid rgba(0,0,0,0.08);
      }
      .pub-title {
        font-family: var(--font-sans);
        font-weight: 700;
        font-size: 32px;
        letter-spacing: -0.03em;
        margin: 0 0 0.5rem 0;
      }
      .pub-description {
        font-family: var(--font-sans);
        font-size: 16px;
        color: var(--text-muted);
        margin: 0 0 1.5rem 0;
        line-height: 1.5;
      }
      .pub-author-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1.5rem;
      }
      .pub-author-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        object-fit: cover;
        background: rgba(0,0,0,0.05);
      }
      .pub-author-info {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
      }
      .pub-author-name {
        font-family: var(--font-sans);
        font-weight: 600;
        font-size: 15px;
      }
      .pub-author-name a { color: inherit; text-decoration: none; }
      .pub-author-name a:hover { text-decoration: underline; }
      .pub-author-handle {
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--text-muted);
      }
      .pub-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: center;
      }
      .pub-meta-item {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        font-family: var(--font-mono, monospace);
        font-size: 12px;
        color: var(--text-muted);
        background: rgba(0,0,0,0.03);
        padding: 0.3rem 0.6rem;
        border-radius: 6px;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pub-meta-item a {
        color: var(--accent, #118156);
        text-decoration: none;
      }
      .pub-meta-item a:hover { text-decoration: underline; }
      .pub-articles-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1.5rem;
      }
      .pub-articles-header h2 {
        font-family: var(--font-sans);
        font-weight: 600;
        font-size: 18px;
        margin: 0;
        letter-spacing: -0.02em;
      }
      .pub-articles-count {
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--text-muted);
      }
      .pub-article-item {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 1rem 0;
        border-bottom: 1px solid rgba(0,0,0,0.06);
        text-decoration: none;
        color: inherit;
        transition: opacity 0.15s;
      }
      .pub-article-item:hover { opacity: 0.75; }
      .pub-article-avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
        margin-top: 0.15rem;
        background: rgba(0,0,0,0.05);
      }
      .pub-article-info {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        min-width: 0;
        flex: 1;
      }
      .pub-article-title {
        font-family: var(--font-sans);
        font-weight: 600;
        font-size: 16px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pub-article-meta {
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--text-muted);
      }
      .pub-empty {
        text-align: center;
        padding: 3rem 2rem;
        color: var(--text-muted);
        font-family: var(--font-sans);
      }
      .pub-source-link {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--text-muted);
        text-decoration: none;
        transition: color 0.15s;
        padding: 0.3rem 0.6rem;
        border: 1px solid rgba(0,0,0,0.1);
        border-radius: 6px;
      }
      .pub-source-link:hover { color: var(--text-main); border-color: rgba(0,0,0,0.25); }
      @media (prefers-color-scheme: dark) {
        .pub-header { border-bottom-color: rgba(255,255,255,0.08); }
        .pub-article-item { border-bottom-color: rgba(255,255,255,0.06); }
        .pub-meta-item { background: rgba(255,255,255,0.05); }
        .pub-author-avatar, .pub-article-avatar { background: rgba(255,255,255,0.1); }
        .pub-source-link { border-color: rgba(255,255,255,0.1); }
        .pub-source-link:hover { border-color: rgba(255,255,255,0.25); }
      }
    </style>

    <div class="pub-container">
      <div class="pub-header">
        <h1 class="pub-title">${publication.title}</h1>
        ${publication.description ? html`<p class="pub-description">${publication.description}</p>` : ''}

        <div class="pub-author-row">
          <img class="pub-author-avatar" src="${publication.authorAvatar || '/static/default-avatar.png'}" alt="" loading="lazy" />
          <div class="pub-author-info">
            <span class="pub-author-name"><a href="/profile/${publication.authorHandle}">${publication.authorName || publication.authorHandle}</a></span>
            <span class="pub-author-handle">@${publication.authorHandle}</span>
          </div>
        </div>

        <div class="pub-meta">
          ${publication.url ? html`
            <span class="pub-meta-item">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              <a href="${publication.url}" target="_blank" rel="noopener">${publication.url}</a>
            </span>
          ` : ''}
          <span class="pub-meta-item" title="${publication.uri}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
            ${publication.collection}/${publication.rkey}
          </span>
          <a href="/publication/${publication.authorDid}/${publication.rkey}/source" class="pub-source-link" title="View raw AT Protocol record">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            View Source
          </a>
        </div>
      </div>

      <div class="pub-articles-header">
        <h2>Articles</h2>
        <span class="pub-articles-count">${articles.length} article${articles.length !== 1 ? 's' : ''}</span>
      </div>

      ${articles.length === 0 ? html`
        <div class="pub-empty">
          <p>No indexed articles found for this publication.</p>
          <p style="font-size: 13px;">Articles appear here once they're indexed from the AT Protocol firehose.</p>
        </div>
      ` : ''}

      ${articles.map(article => html`
        <a href="/post/${article.authorDid}/${article.rkey}" class="pub-article-item">
          <img class="pub-article-avatar" src="${article.authorAvatar || '/static/default-avatar.png'}" alt="" loading="lazy" />
          <div class="pub-article-info">
            <span class="pub-article-title">${article.title || 'Untitled'}</span>
            <span class="pub-article-meta">
              ${article.authorName || article.authorHandle}
              ${article.publishedAt ? html` · ${new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
              ${article.wordCount ? html` · ${article.wordCount.toLocaleString()} words` : ''}
            </span>
          </div>
        </a>
      `)}
    </div>
  `;
}

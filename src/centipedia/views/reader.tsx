/** @jsxImportSource hono/jsx */
import { BASE_STYLES, HEADER_STYLES, NAV_STYLES, FontLinks, TopHeader, LeftNav } from './partials.js';
import type { UserProfile } from './partials.js';
import type { LeafletDocument, LeafletBlock } from '../../weblog/lexicons.js';

// --- Block rendering helpers ---

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderFacets(plaintext: string, facets: any[]): string {
  if (!facets || !Array.isArray(facets) || facets.length === 0) return escapeHtml(plaintext);
  let result = escapeHtml(plaintext);
  const isBold = facets.some(f => f?.features?.some?.((feat: any) => feat?.$type === 'pub.leaflet.richtext.facet#bold'));
  const isItalic = facets.some(f => f?.features?.some?.((feat: any) => feat?.$type === 'pub.leaflet.richtext.facet#italic'));
  const linkFacet = facets.find(f => f?.features?.some?.((feat: any) => feat?.$type === 'app.bsky.richtext.facet#link'));
  if (isBold) result = `<b>${result}</b>`;
  if (isItalic) result = `<i>${result}</i>`;
  if (linkFacet) {
    const linkObj = linkFacet.features.find((feat: any) => feat?.$type === 'app.bsky.richtext.facet#link');
    if (linkObj?.uri) result = `<a href="${escapeHtml(linkObj.uri)}" class="article-link">${result}</a>`;
  }
  return result;
}

function extractBlobCid(imageRef: any): string {
  if (!imageRef) return '';
  if (typeof imageRef === 'string') return imageRef;
  if (imageRef.ref) {
    if (typeof imageRef.ref === 'string') return imageRef.ref;
    if (imageRef.ref.$link) return imageRef.ref.$link;
    if (typeof imageRef.ref.toString === 'function' && imageRef.ref.toString() !== '[object Object]') return imageRef.ref.toString();
  }
  return '';
}

function renderBlocks(blocks: LeafletBlock[], did: string, citationUrls?: string[]): string {
  if (!Array.isArray(blocks)) return '';
  const raw = blocks.map(b => {
    const block = b.block as any;
    if (!block) return '';
    switch (block.$type as string) {
      case 'pub.leaflet.blocks.header': {
        const level = (block as any).level || 2;
        const text = renderFacets((block as any).plaintext || '', (block as any).facets || []);
        const id = (block as any).plaintext?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || '';
        return `<h${level} id="${id}" class="article-heading">${text}</h${level}>`;
      }
      case 'pub.leaflet.blocks.blockquote': {
        const text = renderFacets((block as any).plaintext || '', (block as any).facets || []);
        return `<blockquote class="article-blockquote">${text}</blockquote>`;
      }
      case 'pub.leaflet.blocks.code':
        return `<pre class="article-code"><code>${escapeHtml((block as any).plaintext || '')}</code></pre>`;
      case 'pub.leaflet.blocks.image': {
        const cid = extractBlobCid((block as any).image);
        if (!cid) return '';
        const alt = escapeHtml((block as any).alt || '');
        return `<figure class="article-figure"><img src="/blob/${did}/${cid}" alt="${alt}" loading="lazy" />${alt ? `<figcaption>${alt}</figcaption>` : ''}</figure>`;
      }
      case 'pub.leaflet.blocks.iframe': {
        const url = (block as any).url;
        if (!url) return '';
        return `<div class="article-embed"><iframe src="${escapeHtml(url)}" allowfullscreen sandbox="allow-scripts allow-same-origin allow-popups"></iframe></div>`;
      }
      case 'pub.leaflet.blocks.website': {
        const url = (block as any).src || (block as any).url;
        if (!url) return '';
        try {
          const domain = new URL(url).hostname.replace(/^www\./, '');
          return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="article-website-embed"><span class="embed-title">${escapeHtml(url)}</span><span class="embed-domain">External Link · ${escapeHtml(domain)}</span></a>`;
        } catch { return `<a href="${escapeHtml(url)}" class="article-link">${escapeHtml(url)}</a>`; }
      }
      case 'pub.leaflet.blocks.text':
      default: {
        const text = renderFacets((block as any).plaintext || '', (block as any).facets || []);
        return `<p class="article-paragraph">${text.split('\n').join('<br />')}</p>`;
      }
    }
  }).join('');

  // Post-process: convert [N] citation markers to clickable superscript links
  // Links go directly to the external source URL (new tab) with a title showing the ref number
  return raw.replace(/\[(\d{1,2})\]/g, (match, num) => {
    const idx = parseInt(num, 10) - 1;
    if (citationUrls && citationUrls[idx]) {
      const url = citationUrls[idx];
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="cite-marker" title="Source [${num}]" data-ref="${num}">[${num}]</a>`;
    }
    // Fallback: scroll to reference section if URL unknown
    return `<a href="#ref-${num}" class="cite-marker" title="Reference ${num}">[${num}]</a>`;
  });
}

// --- Extract helpers for metadata ---

export function extractFirstImageUrl(doc: any, did: string): string | null {
  const pages = doc.content?.pages || doc.pages || [];
  for (const page of pages) {
    const blocks = page.blocks || [];
    for (const b of blocks) {
      if (b.block?.$type === 'pub.leaflet.blocks.image') {
        const cid = extractBlobCid(b.block.image);
        if (cid) return `/blob/${did}/${cid}`;
      }
    }
  }
  return null;
}

export function extractExcerpt(doc: any, maxLen = 200): string {
  const pages = doc.content?.pages || doc.pages || [];
  for (const page of pages) {
    const blocks = page.blocks || [];
    for (const b of blocks) {
      if (b.block?.$type === 'pub.leaflet.blocks.text' && b.block.plaintext?.trim()) {
        const text = b.block.plaintext.trim();
        if (text.length <= maxLen) return text;
        return text.substring(0, maxLen).trim() + '…';
      }
    }
  }
  return doc.description || '';
}

export function extractPlainText(doc: any): string {
  const pages = doc.content?.pages || doc.pages || [];
  const texts: string[] = [];
  for (const page of pages) {
    for (const b of (page.blocks || [])) {
      if (b.block?.plaintext) texts.push(b.block.plaintext);
    }
  }
  return texts.join('\n\n');
}

function countWords(doc: any): number {
  const text = extractPlainText(doc);
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

// --- Styles ---

const PAGE_STYLES = `
.center-content { flex: 1; min-width: 0; border-left: 1px solid var(--border); }
.article-container { max-width: 720px; margin: 0 auto; padding: 2.5rem 2rem 4rem; }

/* Article header */
.article-header { margin-bottom: 2.5rem; }
.article-title { font-family: var(--font-sans); font-size: 2.25rem; font-weight: 800; letter-spacing: -0.03em; line-height: 1.2; margin-bottom: 1rem; }
.article-meta-bar { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 0.85rem 0; gap: 1rem; flex-wrap: wrap; }
.article-author { display: flex; align-items: center; gap: 0.75rem; text-decoration: none; color: inherit; }
.article-author img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
.article-author-placeholder { width: 40px; height: 40px; border-radius: 50%; background: var(--text-muted); display: flex; align-items: center; justify-content: center; color: var(--bg); font-weight: 700; font-size: 1rem; }
.article-author-info { display: flex; flex-direction: column; }
.article-author-name { font-family: var(--font-sans); font-weight: 600; font-size: 0.9rem; }
.article-author-date { font-size: 0.8rem; color: var(--text-muted); font-family: var(--font-sans); }
.article-actions { display: flex; align-items: center; gap: 0.75rem; }
.article-action-btn { background: none; border: none; cursor: pointer; color: var(--text-muted); display: flex; align-items: center; gap: 0.35rem; font-family: var(--font-sans); font-size: 0.8rem; padding: 0.3rem 0.5rem; border-radius: 6px; transition: all 0.15s; }
.article-action-btn:hover { color: var(--text-main); background: var(--bg-secondary); }

/* Article body */
.article-body { font-family: var(--font-body); font-size: 1.15rem; font-weight: 300; line-height: 2; }
.article-paragraph { margin: 1.25rem 0; min-height: 1.5rem; }
.article-heading { font-family: var(--font-sans); font-weight: 700; letter-spacing: -0.02em; margin-top: 2.5rem; margin-bottom: 1rem; }
h2.article-heading { font-size: 1.6rem; }
h3.article-heading { font-size: 1.25rem; }
.article-link { color: inherit; text-decoration: underline; text-decoration-color: var(--text-muted); text-underline-offset: 3px; transition: text-decoration-color 0.15s; }
.article-link:hover { text-decoration-color: var(--text-main); }
.article-blockquote { border-left: 3px solid var(--accent); padding-left: 1.25rem; font-style: italic; margin: 1.5rem 0; color: var(--text-secondary); }
.article-code { background: var(--bg-secondary); border: 1px solid var(--border); padding: 1rem 1.25rem; border-radius: 8px; overflow-x: auto; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.85rem; line-height: 1.6; margin: 1.5rem 0; }
.article-figure { margin: 2rem 0; }
.article-figure img { max-width: 100%; border-radius: 8px; display: block; }
.article-figure figcaption { font-size: 0.8rem; color: var(--text-muted); text-align: center; margin-top: 0.5rem; font-family: var(--font-sans); }
.article-embed { position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 8px; margin: 1.5rem 0; background: var(--bg-secondary); }
.article-embed iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0; }
.article-website-embed { display: flex; flex-direction: column; padding: 1.25rem; border: 1px solid var(--border); border-radius: 8px; text-decoration: none; color: inherit; margin: 1.5rem 0; transition: background 0.15s; }
.article-website-embed:hover { background: var(--bg-secondary); }
.embed-title { font-weight: 600; font-family: var(--font-sans); font-size: 0.9rem; margin-bottom: 0.25rem; word-break: break-all; }
.embed-domain { font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-sans); }

/* Comments */
.comments-section { border-top: 1px solid var(--border); padding-top: 2rem; margin-top: 3rem; }
.comments-title { font-family: var(--font-sans); font-size: 1.1rem; font-weight: 600; margin-bottom: 1.5rem; letter-spacing: -0.01em; }
.comment { display: flex; gap: 0.75rem; padding: 1rem 0; border-bottom: 1px solid var(--border); }
.comment-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.comment-body { flex: 1; min-width: 0; }
.comment-header { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.25rem; flex-wrap: wrap; }
.comment-name { font-family: var(--font-sans); font-weight: 600; font-size: 0.85rem; color: var(--text-main); text-decoration: none; }
.comment-handle { font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-sans); }
.comment-text { font-family: var(--font-sans); font-size: 0.9rem; line-height: 1.5; color: var(--text-main); word-break: break-word; }
.comment-actions { display: flex; gap: 1.25rem; margin-top: 0.35rem; }
.comment-action { background: none; border: none; cursor: pointer; color: var(--text-muted); display: flex; align-items: center; gap: 0.25rem; font-family: var(--font-sans); font-size: 0.75rem; padding: 0; transition: color 0.15s; }
.comment-action:hover { color: var(--text-main); }

/* TOC + infobox sidebar */
.article-sidebar { width: 240px; flex-shrink: 0; padding: 1.5rem; position: sticky; top: var(--header-height); height: calc(100vh - var(--header-height)); overflow-y: auto; border-left: 1px solid var(--border); }
.sidebar-section { margin-bottom: 1.5rem; }
.sidebar-section-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin-bottom: 0.75rem; }
.toc-list { list-style: none; display: flex; flex-direction: column; gap: 0.4rem; }
.toc-item { font-size: 0.8rem; }
.toc-item a { color: var(--text-secondary); text-decoration: none; transition: color 0.15s; display: block; padding: 0.15rem 0; }
.toc-item a:hover { color: var(--text-main); }
.toc-item.depth-3 { padding-left: 0.75rem; }

/* Infobox */
.infobox { display: flex; flex-direction: column; gap: 0.6rem; }
.infobox-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; }
.infobox-label { color: var(--text-muted); }
.infobox-value { font-weight: 600; color: var(--text-main); }
.confidence-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 99px; font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.confidence-high { background: rgba(16,185,129,0.1); color: #10b981; }
.confidence-medium { background: rgba(245,158,11,0.1); color: #f59e0b; }
.confidence-low { background: rgba(239,68,68,0.1); color: #ef4444; }
.infobox-topics { display: flex; flex-wrap: wrap; gap: 0.35rem; }
.infobox-topic { padding: 0.2rem 0.5rem; background: var(--bg-secondary); border-radius: 99px; font-size: 0.7rem; color: var(--text-secondary); text-decoration: none; transition: background 0.15s; }
.infobox-topic:hover { background: var(--border); }

/* Inline citation markers */
.cite-marker { display: inline; font-size: 0.7em; font-weight: 700; color: var(--accent); text-decoration: none; vertical-align: super; line-height: 1; padding: 0 0.1em; cursor: pointer; transition: opacity 0.15s; font-family: var(--font-sans); }
.cite-marker:hover { opacity: 0.7; text-decoration: underline; }
.ref-item:target { background: rgba(99,102,241,0.06); border-color: var(--accent); }
.ref-item[id] { scroll-margin-top: 5rem; }

/* References */
.references-section { border-top: 1px solid var(--border); padding-top: 2rem; margin-top: 3rem; }
.references-title { font-family: var(--font-sans); font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; letter-spacing: -0.01em; }
.ref-list { display: flex; flex-direction: column; gap: 0.75rem; }
.ref-item { display: flex; gap: 0.75rem; padding: 0.75rem; border: 1px solid var(--border); border-radius: 8px; transition: background 0.15s; }
.ref-item:hover { background: var(--bg-secondary); }
.ref-endorse { display: flex; flex-direction: column; align-items: center; gap: 0.1rem; padding: 0.3rem 0.35rem; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.15s; flex-shrink: 0; font-family: var(--font-sans); }
.ref-endorse:hover { border-color: var(--text-secondary); color: var(--text-secondary); }
.ref-endorse.endorsed { border-color: #10b981; color: #10b981; background: rgba(16,185,129,0.06); }
.ref-endorse-count { font-size: 0.6rem; font-weight: 700; }
.ref-body { flex: 1; min-width: 0; }
.ref-number { font-size: 0.7rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.15rem; }
.ref-title { font-family: var(--font-sans); font-size: 0.85rem; font-weight: 600; color: var(--accent); text-decoration: none; word-break: break-word; }
.ref-title:hover { text-decoration: underline; }
.ref-excerpt { font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem; line-height: 1.5; }
.ref-meta { font-size: 0.7rem; color: var(--text-muted); margin-top: 0.25rem; font-family: var(--font-sans); }

/* Contributors */
.contributors-section { border-top: 1px solid var(--border); padding-top: 1.5rem; margin-top: 2rem; }
.contributors-title { font-family: var(--font-sans); font-size: 0.85rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--text-secondary); }
.contributors-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.contributor-avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; border: 2px solid var(--bg); margin-right: -0.5rem; transition: transform 0.15s; }
.contributor-avatar:hover { transform: scale(1.15); z-index: 1; }
.contributors-count { font-size: 0.8rem; color: var(--text-muted); margin-left: 0.75rem; }

/* Trust view toggle */
.trust-toggle { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; }
.trust-toggle-btn { padding: 0.35rem 0.8rem; border: 1px solid var(--border); border-radius: 99px; background: transparent; color: var(--text-muted); font-size: 0.75rem; font-weight: 600; font-family: var(--font-sans); cursor: pointer; transition: all 0.15s; }
.trust-toggle-btn:hover { border-color: var(--text-secondary); color: var(--text-secondary); }
.trust-toggle-btn.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
.trust-toggle-label { font-size: 0.7rem; color: var(--text-muted); margin-left: 0.25rem; }
.network-score { display: inline-flex; align-items: center; gap: 0.15rem; padding: 0.1rem 0.35rem; border-radius: 4px; font-size: 0.55rem; font-weight: 700; font-family: var(--font-sans); background: rgba(99,102,241,0.1); color: #6366f1; margin-left: 0.35rem; }
.ref-item.network-boosted { border-color: rgba(99,102,241,0.25); background: rgba(99,102,241,0.03); }

/* Version history */
.version-item { padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
.version-item:last-child { border-bottom: none; }
.version-header { display: flex; justify-content: space-between; align-items: center; }
.version-label { font-size: 0.75rem; font-weight: 600; color: var(--text-main); }
.version-date { font-size: 0.65rem; color: var(--text-muted); }
.version-summary { font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.15rem; }
.version-stats { font-size: 0.6rem; color: var(--text-muted); margin-top: 0.1rem; }

@media (max-width: 1024px) { .article-sidebar { display: none; } }
`;

// --- Types ---

export interface ArticleCitation {
  id: number;
  url: string;
  title: string;
  submittedBy: string | null;
  topic: string | null;
  excerpt: string | null;
  endorsements: number;
  userEndorsed: boolean;
}

export interface Contributor {
  did: string;
  handle: string;
  displayName: string;
  avatar: string;
}

// --- Component ---

export interface ReaderProps {
  doc: any;
  did: string;
  rkey: string;
  authorProfile: UserProfile;
  sessionProfile?: UserProfile | null;
  domain: string;
  canonicalUrl: string;
  ogImageUrl: string | null;
  excerpt: string;
  citations?: ArticleCitation[];
  contributors?: Contributor[];
}

export function ArticleReaderPage({
  doc, did, rkey, authorProfile, sessionProfile, domain,
  canonicalUrl, ogImageUrl, excerpt,
  citations = [], contributors = [],
}: ReaderProps) {
  const title = doc.title || 'Untitled';
  const date = new Date(doc.publishedAt || Date.now());
  const formattedDate = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const isoDate = date.toISOString();
  const displayName = authorProfile?.displayName || authorProfile?.handle || did;
  const avatar = authorProfile?.avatar || '';
  const wordCount = countWords(doc);
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  // Extract blocks
  let blocks: LeafletBlock[] = [];
  if (doc.content?.pages?.[0]?.blocks) blocks = doc.content.pages[0].blocks;
  else if (doc.pages?.[0]?.blocks) blocks = doc.pages[0].blocks;

  // Build TOC from headers
  const toc = blocks
    .filter((b: any) => b.block?.$type === 'pub.leaflet.blocks.header')
    .map((b: any) => {
      const text = b.block.plaintext || '';
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      return { text, id, level: b.block.level || 2 };
    });

  // Build citation URL map for inline [N] links
  const citationUrls = (citations || []).map(c => c.url);

  const renderedContent = renderBlocks(blocks, did, citationUrls);

  // JSON-LD structured data
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: excerpt,
    datePublished: isoDate,
    dateModified: isoDate,
    wordCount,
    author: {
      '@type': 'Person',
      name: displayName,
      url: `https://bsky.app/profile/${authorProfile?.handle || did}`,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Centipedia',
      url: `https://${domain}`,
    },
    mainEntityOfPage: canonicalUrl,
    ...(ogImageUrl ? { image: `https://${domain}${ogImageUrl}` } : {}),
  };

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} — Centipedia</title>
        <meta name="description" content={excerpt} />
        <link rel="canonical" href={canonicalUrl} />
        <link rel="icon" type="image/png" href="/favicon.png" />

        {/* Open Graph */}
        <meta property="og:type" content="article" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={excerpt} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="Centipedia" />
        <meta property="article:published_time" content={isoDate} />
        <meta property="article:author" content={displayName} />
        {ogImageUrl && <meta property="og:image" content={`https://${domain}${ogImageUrl}`} />}
        {ogImageUrl && <meta property="og:image:alt" content={title} />}

        {/* Twitter Card */}
        <meta name="twitter:card" content={ogImageUrl ? 'summary_large_image' : 'summary'} />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={excerpt} />
        {ogImageUrl && <meta name="twitter:image" content={`https://${domain}${ogImageUrl}`} />}

        {/* JSON-LD for search engines and LLM crawlers */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{__html: JSON.stringify(jsonLd)}} />

        <FontLinks />
        <style dangerouslySetInnerHTML={{__html: BASE_STYLES + HEADER_STYLES + NAV_STYLES + PAGE_STYLES}} />
      </head>
      <body>
        <TopHeader profile={sessionProfile} />

        <div class="app-shell">
          <LeftNav active="" profile={sessionProfile} />

          <main class="center-content">
            <div class="article-container">
              <article itemscope itemtype="https://schema.org/Article">
                <header class="article-header">
                  <h1 class="article-title" itemprop="headline">{title}</h1>
                  <div class="article-meta-bar">
                    <a href={`/profile/${authorProfile?.handle || did}`} class="article-author" itemprop="author" itemscope itemtype="https://schema.org/Person">
                      {avatar ? (
                        <img src={avatar} alt="" />
                      ) : (
                        <div class="article-author-placeholder">{displayName.charAt(0).toUpperCase()}</div>
                      )}
                      <div class="article-author-info">
                        <span class="article-author-name" itemprop="name">{displayName}</span>
                        <time class="article-author-date" datetime={isoDate} itemprop="datePublished">
                          {formattedDate} · {readTime} min read
                        </time>
                      </div>
                    </a>
                    <div class="article-actions">
                      <button class="article-action-btn" id="btn-like" title="Like">
                        <svg id="icon-like" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                        </svg>
                        <span id="count-like">Like</span>
                      </button>
                      <button class="article-action-btn" id="btn-repost" title="Repost">
                        <svg id="icon-repost" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
                          <path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                          <path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
                        </svg>
                        <span id="count-repost">Repost</span>
                      </button>
                    </div>
                  </div>
                </header>

                <div class="article-body" itemprop="articleBody" dangerouslySetInnerHTML={{__html: renderedContent}} />

                <meta itemprop="wordCount" content={String(wordCount)} />
              </article>

              {/* References */}
              {citations.length > 0 && (
                <section class="references-section" aria-label="References">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h2 class="references-title" style="margin-bottom: 0;">References ({citations.length})</h2>
                    <div class="trust-toggle" id="trust-toggle">
                      <button class="trust-toggle-btn active" data-view="global">Global</button>
                      <button class="trust-toggle-btn" data-view="network">Your Network</button>
                    </div>
                  </div>
                  <div class="ref-list" id="ref-list">
                    {citations.map((c, i) => (
                      <div class="ref-item" id={`ref-${i + 1}`} data-cid={c.id} data-endorsements={c.endorsements} data-order={i}>
                        <button
                          class={`ref-endorse ${c.userEndorsed ? 'endorsed' : ''}`}
                          data-citation-id={c.id}
                          title="Endorse this source"
                        >
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 19V5M5 12l7-7 7 7" />
                          </svg>
                          <span class="ref-endorse-count">{c.endorsements || ''}</span>
                        </button>
                        <div class="ref-body">
                          <div class="ref-number">[{i + 1}]</div>
                          <a href={c.url} target="_blank" rel="noopener noreferrer" class="ref-title">{c.title}</a>
                          {c.excerpt && <div class="ref-excerpt">{c.excerpt}</div>}
                          <div class="ref-meta">
                            {c.topic && <span>{c.topic} · </span>}
                            {(() => { try { return new URL(c.url).hostname.replace(/^www\./, ''); } catch { return ''; } })()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Contributors */}
              {contributors.length > 0 && (
                <section class="contributors-section">
                  <div class="contributors-title">Contributors</div>
                  <div class="contributors-row">
                    {contributors.map(c => (
                      <a href={`/profile/${c.handle}`} title={`@${c.handle}`}>
                        {c.avatar ? (
                          <img src={c.avatar} alt={c.displayName} class="contributor-avatar" />
                        ) : (
                          <div class="contributor-avatar" style="background: var(--text-muted); display: flex; align-items: center; justify-content: center; color: var(--bg); font-weight: 700; font-size: 0.75rem;">{c.displayName.charAt(0).toUpperCase()}</div>
                        )}
                      </a>
                    ))}
                    <span class="contributors-count">{contributors.length} {contributors.length === 1 ? 'person' : 'people'} contributed sources</span>
                  </div>
                </section>
              )}

              {/* Comments */}
              <section class="comments-section" aria-label="Discussion">
                <h2 class="comments-title">Discussion in the ATmosphere</h2>
                <div id="comments-list">
                  <div style="color: var(--text-muted); font-size: 0.85rem; font-family: var(--font-sans);">Loading comments…</div>
                </div>
              </section>
            </div>
          </main>

          {/* Sidebar: infobox + TOC */}
          <aside class="article-sidebar" aria-label="Article info">
            {/* Infobox */}
            <div class="sidebar-section">
              <div class="sidebar-section-title">Article Info</div>
              <div class="infobox">
                <div class="infobox-row">
                  <span class="infobox-label">Citations</span>
                  <span class="infobox-value">{citations.length}</span>
                </div>
                <div class="infobox-row">
                  <span class="infobox-label">Contributors</span>
                  <span class="infobox-value">{contributors.length}</span>
                </div>
                <div class="infobox-row">
                  <span class="infobox-label">Words</span>
                  <span class="infobox-value">{wordCount.toLocaleString()}</span>
                </div>
                <div class="infobox-row">
                  <span class="infobox-label">Confidence</span>
                  <span class={`confidence-badge ${citations.length >= 5 ? 'confidence-high' : citations.length >= 3 ? 'confidence-medium' : 'confidence-low'}`}>
                    {citations.length >= 5 ? 'High' : citations.length >= 3 ? 'Medium' : 'Low'}
                  </span>
                </div>
                {/* Topics */}
                {(() => {
                  const topics = [...new Set(citations.map(c => c.topic).filter(Boolean))];
                  return topics.length > 0 ? (
                    <div style="margin-top: 0.25rem;">
                      <div class="infobox-label" style="margin-bottom: 0.35rem;">Topics</div>
                      <div class="infobox-topics">
                        {topics.map(t => <a href={`/topics/${t!.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`} class="infobox-topic">{t}</a>)}
                      </div>
                    </div>
                  ) : null;
                })()}
              </div>
            </div>

            {/* TOC */}
            {toc.length > 2 && (
              <div class="sidebar-section">
                <div class="sidebar-section-title">On This Page</div>
                <ul class="toc-list">
                  {toc.map(h => (
                    <li class={`toc-item ${h.level >= 3 ? 'depth-3' : ''}`}>
                      <a href={`#${h.id}`}>{h.text}</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Version History (loaded dynamically) */}
            <div class="sidebar-section" id="version-history-section" style="display: none;">
              <div class="sidebar-section-title">Version History</div>
              <div id="version-history-list"></div>
            </div>
          </aside>
        </div>

        <script dangerouslySetInnerHTML={{__html: `
          const authorDid = '${did}';
          const rkey = '${rkey}';

          // Version history
          (async function() {
            try {
              const res = await fetch('/api/article-versions/' + rkey);
              if (!res.ok) return;
              const data = await res.json();
              if (data.versions && data.versions.length > 0) {
                const section = document.getElementById('version-history-section');
                const list = document.getElementById('version-history-list');
                section.style.display = '';
                list.innerHTML = data.versions.map(v => {
                  const d = new Date(v.created_at);
                  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  return '<div class="version-item"><div class="version-header"><span class="version-label">v' + v.version + '</span><span class="version-date">' + dateStr + '</span></div><div class="version-summary">' + (v.summary || '') + '</div><div class="version-stats">' + v.word_count + ' words · ' + v.citations_used + ' sources</div></div>';
                }).join('');
              }
            } catch(e) {}
          })();

          // Comments
          (async function() {
            try {
              const url = encodeURIComponent(window.location.href);
              const res = await fetch('/api/comments?url=' + url);
              const data = await res.json();
              const container = document.getElementById('comments-list');
              if (!data.posts || data.posts.length === 0) {
                container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; font-family: var(--font-sans);">Be the first to discuss this article in the ATmosphere!</div>';
                return;
              }
              let h = '';
              for (const post of data.posts) {
                const a = post.author;
                const t = (post.record.text || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\n/g,'<br/>');
                const av = a.avatar ? '<img src="'+a.avatar+'" class="comment-avatar" />' : '<div class="comment-avatar" style="background:var(--text-muted);"></div>';
                const pd = new Date(post.indexedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'});
                const pu = post.uri.replace('at://','').split('/');
                const bu = 'https://bsky.app/profile/'+a.handle+'/post/'+pu[2];
                h += '<div class="comment">' + '<a href="https://bsky.app/profile/'+a.handle+'" target="_blank" style="flex-shrink:0;">'+av+'</a>' + '<div class="comment-body">' + '<div class="comment-header"><a href="https://bsky.app/profile/'+a.handle+'" target="_blank" class="comment-name">'+(a.displayName||a.handle)+'</a><span class="comment-handle">@'+a.handle+' · '+pd+'</span></div>' + '<div class="comment-text">'+t+'</div>' + '<div class="comment-actions"><a href="'+bu+'" target="_blank" class="comment-action">Reply</a></div>' + '</div></div>';
              }
              container.innerHTML = h;
            } catch(e) {
              document.getElementById('comments-list').innerHTML = '<div style="color:#dc2626;font-size:0.85rem;">Failed to load comments</div>';
            }
          })();

          // Like / Repost actions
          async function handleAction(action) {
            try {
              const res = await fetch('/api/' + action, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rkey, authorDid, title: document.querySelector('.article-title').textContent })
              });
              if (res.status === 401) { location.href = '/login'; return; }
              const data = await res.json();
              if (data.success) {
                const btn = document.getElementById('btn-' + action);
                const icon = document.getElementById('icon-' + action);
                btn.style.color = action === 'like' ? '#f02050' : '#10b981';
                if (action === 'like') icon.setAttribute('fill', 'currentColor');
                const count = document.getElementById('count-' + action);
                const n = parseInt(count.innerText) || 0;
                count.innerText = (n + 1).toString();
              }
            } catch(e) {}
          }

          document.getElementById('btn-like').addEventListener('click', () => handleAction('like'));
          document.getElementById('btn-repost').addEventListener('click', () => handleAction('repost'));

          // Fetch initial stats
          (async function() {
            try {
              const res = await fetch('/api/stats?authorDid=' + authorDid + '&rkey=' + rkey);
              const data = await res.json();
              if (data.likes > 0) document.getElementById('count-like').innerText = data.likes.toString();
              if (data.liked) { document.getElementById('btn-like').style.color = '#f02050'; document.getElementById('icon-like').setAttribute('fill', 'currentColor'); }
              if (data.reposts > 0) document.getElementById('count-repost').innerText = data.reposts.toString();
              if (data.reposted) document.getElementById('btn-repost').style.color = '#10b981';
            } catch(e) {}
          })();

          // Reference endorsement handlers
          document.querySelectorAll('.ref-endorse').forEach(btn => {
            btn.addEventListener('click', async () => {
              const citationId = Number(btn.dataset.citationId);
              try {
                const res = await fetch('/api/endorse/citation', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ citationId })
                });
                if (res.status === 401) { location.href = '/login'; return; }
                const data = await res.json();
                if (res.ok) {
                  btn.classList.toggle('endorsed', data.endorsed);
                  btn.querySelector('.ref-endorse-count').textContent = data.count || '';
                }
              } catch(e) {}
            });
          });

          // "Your Network" trust view toggle
          let networkScoresCache = null;
          const toggleBtns = document.querySelectorAll('#trust-toggle .trust-toggle-btn');
          const refList = document.getElementById('ref-list');
          
          toggleBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
              toggleBtns.forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              const view = btn.dataset.view;

              if (view === 'network') {
                // Fetch network scores if not cached
                if (!networkScoresCache) {
                  try {
                    const res = await fetch('/api/network-scores?rkey=' + rkey);
                    if (res.status === 401) { location.href = '/login'; return; }
                    networkScoresCache = await res.json();
                  } catch(e) {
                    console.error('Failed to fetch network scores', e);
                    return;
                  }
                }
                // Apply network scores and re-sort
                const items = [...refList.querySelectorAll('.ref-item')];
                const scoreMap = {};
                (networkScoresCache.scores || []).forEach(s => { scoreMap[s.citationId] = s.networkScore; });
                
                items.forEach(item => {
                  const cid = Number(item.dataset.cid);
                  const ns = scoreMap[cid] || 0;
                  item.dataset.networkScore = ns;
                  item.classList.toggle('network-boosted', ns > 0);
                  // Add or update network score badge
                  let badge = item.querySelector('.network-score');
                  if (ns > 0) {
                    if (!badge) {
                      badge = document.createElement('span');
                      badge.className = 'network-score';
                      item.querySelector('.ref-meta')?.appendChild(badge);
                    }
                    badge.textContent = '⚡ ' + ns + ' trust';
                  } else if (badge) {
                    badge.remove();
                  }
                });
                // Sort by network score desc, then endorsements
                items.sort((a, b) => (Number(b.dataset.networkScore) - Number(a.dataset.networkScore)) || (Number(b.dataset.endorsements) - Number(a.dataset.endorsements)));
                items.forEach(item => refList.appendChild(item));
              } else {
                // Reset to global order
                const items = [...refList.querySelectorAll('.ref-item')];
                items.forEach(item => {
                  item.classList.remove('network-boosted');
                  const badge = item.querySelector('.network-score');
                  if (badge) badge.remove();
                });
                items.sort((a, b) => Number(a.dataset.order) - Number(b.dataset.order));
                items.forEach(item => refList.appendChild(item));
              }
            });
          });
          // Inline citation click — only handle #ref- anchor links (fallback)
          // External source links (target="_blank") open naturally in new tabs
          document.querySelectorAll('.cite-marker[href^="#ref-"]').forEach(link => {
            link.addEventListener('click', (e) => {
              e.preventDefault();
              const refId = link.getAttribute('href')?.replace('#', '');
              if (!refId) return;
              const target = document.getElementById(refId);
              if (!target) return;
              // Scroll with offset
              const y = target.getBoundingClientRect().top + window.scrollY - 80;
              window.scrollTo({ top: y, behavior: 'smooth' });
              // Flash highlight
              target.style.transition = 'background 0.3s, border-color 0.3s';
              target.style.background = 'rgba(99,102,241,0.08)';
              target.style.borderColor = 'var(--accent)';
              setTimeout(() => {
                target.style.background = '';
                target.style.borderColor = '';
              }, 2000);
              history.replaceState(null, '', '#' + refId);
            });
          });
        `}} />
      </body>
    </html>
  );
}

import { marked } from 'marked';

/**
 * Detects whether textContent is markdown, HTML, or plain text.
 * Returns rendered HTML in all cases.
 * If the content looks like a Leaflet block structure (JSON object),
 * it will be parsed and rendered from blocks automatically.
 */
export function renderContent(textContent: string, maxLength?: number): string {
  if (!textContent) return '';

  // Detect Leaflet JSON content (starts with { and has pages/blocks)
  const leafletText = tryExtractLeafletText(textContent);
  if (leafletText !== null) {
    let content = leafletText;
    if (maxLength && content.length > maxLength) {
      content = content.substring(0, maxLength);
      const lastSpace = content.lastIndexOf(' ');
      if (lastSpace > maxLength * 0.7) content = content.substring(0, lastSpace);
      content += '…';
    }
    return renderPlainText(content);
  }

  let content = textContent;

  // Truncate if needed (before rendering to avoid breaking tags)
  if (maxLength && content.length > maxLength) {
    content = content.substring(0, maxLength);
    // Don't break mid-word
    const lastSpace = content.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.7) content = content.substring(0, lastSpace);
    content += '…';
  }

  const format = detectFormat(content);

  switch (format) {
    case 'html':
      return sanitizeHtml(content);
    case 'markdown':
      return renderMarkdown(content);
    default:
      return renderPlainText(content);
  }
}

/**
 * Detect content format from the raw text.
 */
export function detectFormat(text: string): 'markdown' | 'html' | 'plain' {
  // Check for HTML first (more specific)
  if (/<(?:p|div|h[1-6]|br|ul|ol|li|table|blockquote|pre|img|a\s)[^>]*>/i.test(text)) {
    return 'html';
  }

  // Check for markdown patterns
  const mdPatterns = [
    /^#{1,6}\s/m,           // headings
    /\*\*[^*]+\*\*/,        // bold
    /\*[^*]+\*/,            // italic
    /^\s*[-*+]\s/m,         // unordered lists
    /^\s*\d+\.\s/m,         // ordered lists
    /```[\s\S]*?```/,       // code blocks
    /`[^`]+`/,              // inline code
    /^\s*>/m,               // blockquotes
    /\[.+?\]\(.+?\)/,       // links
    /!\[.*?\]\(.+?\)/,      // images
    /^---$/m,               // horizontal rules
    /^\|.*\|.*\|/m,         // tables
  ];

  let mdScore = 0;
  for (const pattern of mdPatterns) {
    if (pattern.test(text)) mdScore++;
  }

  // If 2+ markdown patterns found, treat as markdown
  if (mdScore >= 2) return 'markdown';

  // Single pattern + long-ish content → probably markdown
  if (mdScore >= 1 && text.length > 200) return 'markdown';

  return 'plain';
}

function renderMarkdown(text: string): string {
  try {
    return marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
  } catch {
    return renderPlainText(text);
  }
}

function renderPlainText(text: string): string {
  // Escape HTML entities
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Convert double newlines to paragraphs, single newlines to breaks
  const paragraphs = escaped.split(/\n\n+/);
  if (paragraphs.length > 1) {
    return paragraphs
      .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  return `<p>${escaped.replace(/\n/g, '<br>')}</p>`;
}

function sanitizeHtml(htmlStr: string): string {
  // Basic sanitization: strip script/style tags, event handlers
  return htmlStr
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=/gi, ' data-removed=')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
}

/**
 * Determines if the title should be shown separately from the content.
 * Returns false if title is redundant with content (microblog style).
 */
export function shouldShowTitle(title: string | null, textContent: string | null): boolean {
  if (!title || !title.trim()) return false;
  if (!textContent || !textContent.trim()) return true;

  const normTitle = title.trim().toLowerCase();
  const normContent = textContent.trim().toLowerCase();

  // Title equals content — microblog
  if (normTitle === normContent) return false;

  // Content starts with title — microblog
  if (normContent.startsWith(normTitle)) return false;

  // Title is just the first line of content
  const firstLine = normContent.split('\n')[0].replace(/^#+\s*/, '');
  if (normTitle === firstLine) return false;

  return true;
}

/**
 * Extract a hostname from a URL for display.
 */
export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ── Leaflet block helpers ────────────────────────────────────────────────────

/**
 * Try to parse a string as Leaflet block JSON and extract plain text.
 * Returns null if the string is not a Leaflet structure.
 */
function tryExtractLeafletText(text: string): string | null {
  if (!text || text[0] !== '{') return null;
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object' && (obj.pages || obj.content?.pages)) {
      return extractLeafletPlaintext(obj);
    }
  } catch {}
  return null;
}

/**
 * Extract plain text from a Leaflet block content object.
 * Works for both `{ pages: [...] }` and `{ content: { pages: [...] } }` shapes.
 */
export function extractLeafletPlaintext(content: any): string {
  const pages = content?.pages || content?.content?.pages || [];
  const lines: string[] = [];

  for (const page of pages) {
    const blocks = page.blocks || [];
    for (const blockWrapper of blocks) {
      const b = blockWrapper.block || blockWrapper;
      if (b.plaintext) lines.push(b.plaintext);
    }
  }

  return lines.join('\n\n');
}

/**
 * Render Leaflet blocks to full HTML for the reader view.
 * Handles text, header, blockquote, code, image, separator, and iframe blocks.
 */
export function renderLeafletHtml(content: any, authorDid: string): string {
  const pages = content?.pages || content?.content?.pages || [];
  const parts: string[] = [];

  for (const page of pages) {
    const blocks = page.blocks || [];
    for (const blockWrapper of blocks) {
      const b = blockWrapper.block || blockWrapper;
      const btype = b.$type || '';

      if (btype === 'pub.leaflet.blocks.text') {
        parts.push(`<p>${applyFacets(escapeHtml(b.plaintext || ''), b.facets)}</p>`);
      } else if (btype === 'pub.leaflet.blocks.header') {
        const level = Math.min(Math.max(b.level || 2, 1), 6);
        parts.push(`<h${level}>${applyFacets(escapeHtml(b.plaintext || ''), b.facets)}</h${level}>`);
      } else if (btype === 'pub.leaflet.blocks.blockquote') {
        parts.push(`<blockquote><p>${applyFacets(escapeHtml(b.plaintext || ''), b.facets)}</p></blockquote>`);
      } else if (btype === 'pub.leaflet.blocks.code') {
        const lang = b.language ? ` class="language-${escapeHtml(b.language)}"` : '';
        parts.push(`<pre><code${lang}>${escapeHtml(b.plaintext || '')}</code></pre>`);
      } else if (btype === 'pub.leaflet.blocks.image') {
        const cid = b.image?.ref?.$link || b.image?.ref?.['$link'] || '';
        if (cid) {
          const alt = escapeHtml(b.alt || '');
          parts.push(`<figure><img src="https://cdn.bsky.app/img/feed_thumbnail/plain/${authorDid}/${cid}@jpeg" alt="${alt}" loading="lazy" style="max-width:100%;border-radius:8px;" />${alt ? `<figcaption>${alt}</figcaption>` : ''}</figure>`);
        }
      } else if (btype === 'pub.leaflet.blocks.separator') {
        parts.push('<hr />');
      } else if (btype === 'pub.leaflet.blocks.iframe') {
        if (b.url) parts.push(`<p><a href="${escapeHtml(b.url)}" target="_blank" rel="noopener">${escapeHtml(b.url)}</a></p>`);
      } else if (b.plaintext) {
        parts.push(`<p>${escapeHtml(b.plaintext)}</p>`);
      }
    }
  }

  return parts.join('\n');
}

/**
 * Detect whether a content value is a Leaflet block structure.
 */
export function isLeafletContent(contentValue: any): boolean {
  if (typeof contentValue === 'string') {
    if (contentValue[0] !== '{') return false;
    try {
      const obj = JSON.parse(contentValue);
      return obj && typeof obj === 'object' && !!(obj.pages || obj.content?.pages);
    } catch {
      return false;
    }
  }
  if (contentValue && typeof contentValue === 'object') {
    return !!(contentValue.pages || contentValue.content?.pages);
  }
  return false;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Apply Leaflet facets (bold, italic, links) to escaped plaintext.
 * Facets use byte offsets, similar to Bluesky richtext facets.
 */
function applyFacets(escapedText: string, facets?: any[]): string {
  if (!facets || facets.length === 0) return escapedText;

  let result = escapedText;

  // Sort facets by byteStart descending so insertions don't shift offsets
  const sorted = [...facets].sort((a, b) => (b.index?.byteStart ?? 0) - (a.index?.byteStart ?? 0));

  for (const facet of sorted) {
    const start = facet.index?.byteStart;
    const end = facet.index?.byteEnd;
    if (start == null || end == null) continue;

    const features = facet.features || [];
    for (const feat of features) {
      const ftype = feat.$type || '';
      const segment = result.substring(start, end);
      if (ftype === 'pub.leaflet.richtext.facet#link' || ftype === 'app.bsky.richtext.facet#link') {
        const href = escapeHtml(feat.uri || '');
        result = result.substring(0, start) + `<a href="${href}" target="_blank" rel="noopener">${segment}</a>` + result.substring(end);
      } else if (ftype === 'pub.leaflet.richtext.facet#bold') {
        result = result.substring(0, start) + `<strong>${segment}</strong>` + result.substring(end);
      } else if (ftype === 'pub.leaflet.richtext.facet#italic') {
        result = result.substring(0, start) + `<em>${segment}</em>` + result.substring(end);
      }
    }
  }

  return result;
}

import sanitizeHtml from 'sanitize-html';

/**
 * Sanitize HTML content for safe rendering in article bodies.
 * Allows standard content tags (p, h1-h6, a, img, lists, etc.)
 * but strips all scripts, iframes, event handlers, and dangerous attributes.
 */
export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      // Block elements
      'p', 'div', 'br', 'hr',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'blockquote', 'pre', 'code',
      // Lists
      'ul', 'ol', 'li',
      // Inline formatting
      'a', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins',
      'sub', 'sup', 'mark', 'small', 'abbr', 'span',
      // Media (images only — no iframes, no video/audio)
      'img',
      // Tables
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
      // Figures
      'figure', 'figcaption', 'picture', 'source',
    ],
    allowedAttributes: {
      'a': ['href', 'title', 'target', 'rel'],
      'img': ['src', 'alt', 'width', 'height', 'loading'],
      'source': ['srcset', 'type', 'width', 'height', 'loading'],
      'td': ['colspan', 'rowspan'],
      'th': ['colspan', 'rowspan', 'scope'],
      'blockquote': ['cite'],
      'abbr': ['title'],
      'span': ['class'],
      'div': ['class'],
      'pre': ['class'],
      'code': ['class'],
      'figure': ['class'],
      'p': ['class'],
    },
    // Only allow http/https links and relative paths — no javascript: URIs
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      'img': ['http', 'https', 'data'],
    },
    // Force all links to open safely
    transformTags: {
      'a': (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
    },
    // Strip everything not explicitly allowed (including event handlers like onclick, onerror, etc.)
    disallowedTagsMode: 'discard',
  });
}

/**
 * Sanitize inline text that may contain basic formatting (from facets, etc.)
 * More restrictive than article body — only allows inline formatting tags.
 */
export function sanitizeInlineHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['a', 'strong', 'b', 'em', 'i', 'u', 'code', 'br', 'span'],
    allowedAttributes: {
      'a': ['href', 'title', 'target', 'rel'],
      'span': ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      'a': (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          rel: 'noopener noreferrer',
        },
      }),
    },
    disallowedTagsMode: 'discard',
  });
}

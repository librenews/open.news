import { marked } from 'marked';

/**
 * Detects whether textContent is markdown, HTML, or plain text.
 * Returns rendered HTML in all cases.
 */
export function renderContent(textContent: string, maxLength?: number): string {
  if (!textContent) return '';

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

function sanitizeHtml(html: string): string {
  // Basic sanitization: strip script/style tags, event handlers
  return html
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

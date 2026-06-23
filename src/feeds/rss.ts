import { RichText } from '@atproto/api';

export interface RssFeedItem {
  title: string;
  link: string;
  description: string; // HTML description
  authorName: string;
  authorUri?: string;
  pubDate: string | null;
  guid: string;
  imageUrl?: string | null;
  markdown?: string | null; // Used for source:markdown element
}

export interface RssFeedOptions {
  title: string;
  description: string;
  link: string;
  feedUrl: string;
  cloudUrl?: string; // Optional cloud registration endpoint
  language?: string;
  imageUrl?: string;
  items: RssFeedItem[];
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Extract image URL from a Bluesky post embed metadata
 */
export function getPostImageUrl(embed: any, authorDid: string): string | null {
  if (!embed) return null;

  // 1. Direct thumbnail strings on the embed root (e.g. app.bsky.embed.video#view)
  if (typeof embed.thumbnail === 'string' && embed.thumbnail.startsWith('http')) {
    return embed.thumbnail;
  }
  if (embed.thumbnail?.ref?.$link || embed.thumbnail?.ref?.['$link']) {
    const cid = embed.thumbnail.ref.$link || embed.thumbnail.ref['$link'];
    return `https://cdn.bsky.app/img/feed_fullsize/plain/${authorDid}/${cid}@jpeg`;
  }

  // 2. Handle app.bsky.embed.images or images array
  if (embed.$type === 'app.bsky.embed.images' || embed.$type === 'app.bsky.embed.images#view' || Array.isArray(embed.images)) {
    const firstImg = embed.images?.[0];
    if (firstImg) {
      if (typeof firstImg.fullsize === 'string' && firstImg.fullsize.startsWith('http')) {
        return firstImg.fullsize;
      }
      if (typeof firstImg.thumb === 'string' && firstImg.thumb.startsWith('http')) {
        return firstImg.thumb;
      }
      const cid = firstImg.image?.ref?.$link || firstImg.image?.ref?.['$link'] || firstImg.ref?.$link;
      if (cid) {
        return `https://cdn.bsky.app/img/feed_fullsize/plain/${authorDid}/${cid}@jpeg`;
      }
    }
  }

  // 3. Handle app.bsky.embed.external or external view
  const external = embed.external;
  if (external) {
    if (typeof external.thumb === 'string' && external.thumb.startsWith('http')) {
      return external.thumb;
    }
    const cid = external.thumb?.ref?.$link || external.thumb?.ref?.['$link'];
    if (cid) {
      return `https://cdn.bsky.app/img/feed_fullsize/plain/${authorDid}/${cid}@jpeg`;
    }
  }

  // 4. Handle video thumbnail blobs on record (app.bsky.embed.video)
  if (embed.video?.thumbnail?.ref?.$link || embed.video?.thumbnail?.ref?.['$link']) {
    const cid = embed.video.thumbnail.ref.$link || embed.video.thumbnail.ref['$link'];
    return `https://cdn.bsky.app/img/feed_fullsize/plain/${authorDid}/${cid}@jpeg`;
  }

  // 5. Handle app.bsky.embed.recordWithMedia
  if (embed.media) {
    return getPostImageUrl(embed.media, authorDid);
  }

  return null;
}

/**
 * Apply markdown formatting markers based on byte offsets.
 */
export function applyMarkdownFacets(plaintext: string, facets?: any[]): string {
  if (!facets || facets.length === 0) return plaintext;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(plaintext);

  interface Insertion {
    index: number;
    insert: string;
    priority: number;
  }
  const insertions: Insertion[] = [];

  for (const facet of facets) {
    const start = facet.index?.byteStart;
    const end = facet.index?.byteEnd;
    if (start == null || end == null) continue;

    for (const feat of facet.features || []) {
      const ftype = feat.$type || '';
      if (ftype === 'pub.leaflet.richtext.facet#bold') {
        insertions.push({ index: start, insert: '**', priority: 1 });
        insertions.push({ index: end, insert: '**', priority: -1 });
      } else if (ftype === 'pub.leaflet.richtext.facet#italic') {
        insertions.push({ index: start, insert: '_', priority: 2 });
        insertions.push({ index: end, insert: '_', priority: -2 });
      } else if (ftype === 'pub.leaflet.richtext.facet#strikethrough' || ftype === 'pub.leaflet.richtext.facet#strike') {
        insertions.push({ index: start, insert: '~~', priority: 3 });
        insertions.push({ index: end, insert: '~~', priority: -3 });
      } else if (ftype === 'pub.leaflet.richtext.facet#link' || ftype === 'app.bsky.richtext.facet#link') {
        const uri = feat.uri || '';
        insertions.push({ index: start, insert: '[', priority: 4 });
        insertions.push({ index: end, insert: `](${uri})`, priority: -4 });
      }
    }
  }

  insertions.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    return a.priority - b.priority;
  });

  let result = '';
  let currentByte = 0;
  for (const ins of insertions) {
    if (ins.index > currentByte) {
      result += decoder.decode(bytes.subarray(currentByte, ins.index));
      currentByte = ins.index;
    }
    result += ins.insert;
  }
  if (currentByte < bytes.length) {
    result += decoder.decode(bytes.subarray(currentByte));
  }
  return result;
}

/**
 * Convert a Leaflet document (JSON block format) into Markdown.
 */
export function leafletToMarkdown(content: any, authorDid: string): string {
  if (!content) return '';
  if (typeof content === 'string') return content;

  const pages = content.pages || content.content?.pages || [];
  const parts: string[] = [];

  for (const page of pages) {
    const blocks = page.blocks || [];
    for (const blockWrapper of blocks) {
      const b = blockWrapper.block || blockWrapper;
      const btype = b.$type || '';

      if (btype === 'pub.leaflet.blocks.text') {
        parts.push(applyMarkdownFacets(b.plaintext || '', b.facets));
      } else if (btype === 'pub.leaflet.blocks.header') {
        const level = Math.min(Math.max(b.level || 2, 1), 6);
        const prefix = '#'.repeat(level);
        parts.push(`${prefix} ${applyMarkdownFacets(b.plaintext || '', b.facets)}`);
      } else if (btype === 'pub.leaflet.blocks.blockquote') {
        parts.push(`> ${applyMarkdownFacets(b.plaintext || '', b.facets)}`);
      } else if (btype === 'pub.leaflet.blocks.code') {
        const lang = b.language || '';
        parts.push(`\`\`\`${lang}\n${b.plaintext || ''}\n\`\`\``);
      } else if (btype === 'pub.leaflet.blocks.image') {
        const cid = b.image?.ref?.$link || b.image?.ref?.['$link'] || '';
        if (cid) {
          const alt = b.alt || '';
          parts.push(`![${alt}](https://cdn.bsky.app/img/feed_fullsize/plain/${authorDid}/${cid}@jpeg)`);
        }
      } else if (btype === 'pub.leaflet.blocks.separator') {
        parts.push('---');
      } else if (btype === 'pub.leaflet.blocks.iframe') {
        if (b.url) parts.push(`[${b.url}](${b.url})`);
      } else if (b.plaintext) {
        parts.push(b.plaintext);
      }
    }
  }

  return parts.join('\n\n');
}

/**
 * Format a Bluesky post (text + facets) to HTML for RSS description.
 */
export function postToHtml(text: string, facets?: any[]): string {
  if (!text) return '';
  const rt = new RichText({ text, facets });
  let html = '';
  for (const segment of rt.segments()) {
    if (segment.isLink()) {
      html += `<a href="${escapeXml(segment.link.uri)}">${escapeXml(segment.text)}</a>`;
    } else if (segment.isMention()) {
      html += `<a href="https://bsky.app/profile/${escapeXml(segment.mention.did)}">${escapeXml(segment.text)}</a>`;
    } else if (segment.isTag()) {
      html += `<a href="https://bsky.app/tag/${escapeXml(segment.tag?.tag || segment.text.replace('#', ''))}">${escapeXml(segment.text)}</a>`;
    } else {
      html += escapeXml(segment.text).replace(/\n/g, '<br />');
    }
  }
  return html;
}

/**
 * Generate full-featured RSS 2.0 Feed XML.
 */
export function generateRssFeed(opts: RssFeedOptions): string {
  const itemsXml = opts.items.map(item => {
    const enclosure = item.imageUrl
      ? `      <enclosure url="${escapeXml(item.imageUrl)}" type="image/jpeg" length="0" />\n      <media:content url="${escapeXml(item.imageUrl)}" medium="image" />\n      <media:thumbnail url="${escapeXml(item.imageUrl)}" />`
      : '';

    const contentEncoded = item.description
      ? `      <content:encoded><![CDATA[${item.description}]]></content:encoded>`
      : '';

    const markdownElement = item.markdown
      ? `      <source:markdown><![CDATA[${item.markdown}]]></source:markdown>`
      : '';

    return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <description><![CDATA[${item.description}]]></description>
      <dc:creator>${escapeXml(item.authorName)}</dc:creator>
${item.authorUri ? `      <author>${escapeXml(item.authorUri)}</author>` : ''}
${item.pubDate ? `      <pubDate>${new Date(item.pubDate).toUTCString()}</pubDate>` : ''}
      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
${enclosure}
${contentEncoded}
${markdownElement}
    </item>`;
  }).join('\n');

  const channelImage = opts.imageUrl ? `
    <image>
      <url>${escapeXml(opts.imageUrl)}</url>
      <title>${escapeXml(opts.title)}</title>
      <link>${escapeXml(opts.link)}</link>
    </image>` : '';

  let cloudTag = '';
  if (opts.cloudUrl) {
    try {
      const url = new URL(opts.cloudUrl);
      const domain = url.hostname;
      const port = url.port || (url.protocol === 'https:' ? '443' : '80');
      cloudTag = `\n    <cloud domain="${domain}" port="${port}" path="/pleaseNotify" registerProcedure="" protocol="http-post" />`;
    } catch {}
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:media="http://search.yahoo.com/mrss/"
  xmlns:source="https://source.scripting.com/">
  <channel>
    <title>${escapeXml(opts.title)}</title>
    <description>${escapeXml(opts.description)}</description>
    <link>${escapeXml(opts.link)}</link>
    <atom:link href="${escapeXml(opts.feedUrl)}" rel="self" type="application/rss+xml" />
    <language>${opts.language || 'en'}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>feeds.social RSS</generator>
    <docs>https://www.rssboard.org/rss-specification</docs>
    <ttl>5</ttl>${cloudTag}${channelImage}
${itemsXml}
  </channel>
</rss>`;
}

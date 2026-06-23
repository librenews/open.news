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
 * Format a Bluesky post's embed payload (images, external link card, video, quote post) into HTML.
 */
export function formatEmbedHtml(embed: any, authorDid: string): string {
  if (!embed) return '';
  let html = '';

  const type = embed.$type || '';

  // 1. Images
  if (type === 'app.bsky.embed.images' || type === 'app.bsky.embed.images#view' || Array.isArray(embed.images)) {
    const images = embed.images || [];
    for (const img of images) {
      const src = img.fullsize || img.thumb || (img.image?.ref?.$link ? `https://cdn.bsky.app/img/feed_fullsize/plain/${authorDid}/${img.image.ref.$link}@jpeg` : '');
      if (src) {
        const alt = img.alt || '';
        html += `<br /><br /><img src="${escapeXml(src)}" alt="${escapeXml(alt)}" style="max-width: 100%; border-radius: 8px;" />`;
      }
    }
  }

  // 2. External Card
  const external = embed.external;
  if (external) {
    const uri = external.uri || '';
    const title = external.title || '';
    const desc = external.description || '';
    const thumbUrl = typeof external.thumb === 'string' && external.thumb.startsWith('http')
      ? external.thumb
      : (external.thumb?.ref?.$link ? `https://cdn.bsky.app/img/feed_fullsize/plain/${authorDid}/${external.thumb.ref.$link}@jpeg` : '');

    let host = '';
    try {
      host = new URL(uri).hostname;
    } catch {}

    html += `<br /><br />
<div style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; max-width: 550px; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <a href="${escapeXml(uri)}" target="_blank" rel="noopener" style="text-decoration: none; color: inherit; display: block;">
    ${thumbUrl ? `<img src="${escapeXml(thumbUrl)}" style="width: 100%; height: auto; max-height: 250px; object-fit: cover; border-bottom: 1px solid #e2e8f0;" />` : ''}
    <div style="padding: 12px;">
      <div style="font-weight: bold; font-size: 14px; line-height: 1.4; color: #0f172a; margin-bottom: 4px;">${escapeXml(title)}</div>
      ${desc ? `<div style="font-size: 12px; line-height: 1.5; color: #64748b; margin-bottom: 6px;">${escapeXml(desc)}</div>` : ''}
      ${host ? `<div style="font-size: 11px; color: #94a3b8; font-weight: 500; text-transform: lowercase;">${escapeXml(host)}</div>` : ''}
    </div>
  </a>
</div>`;
  }

  // 3. Video
  if (type === 'app.bsky.embed.video' || type === 'app.bsky.embed.video#view') {
    const playlist = embed.playlist || '';
    const thumbUrl = typeof embed.thumbnail === 'string' && embed.thumbnail.startsWith('http')
      ? embed.thumbnail
      : (embed.thumbnail?.ref?.$link ? `https://cdn.bsky.app/img/feed_fullsize/plain/${authorDid}/${embed.thumbnail.ref.$link}@jpeg` : '');
    
    html += `<br /><br />
<div style="position: relative; max-width: 550px; border-radius: 12px; overflow: hidden; background-color: #000;">
  <a href="${escapeXml(playlist || thumbUrl || '#')}" target="_blank" rel="noopener" style="display: block;">
    ${thumbUrl ? `<img src="${escapeXml(thumbUrl)}" style="width: 100%; height: auto; opacity: 0.8;" />` : ''}
    <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 48px; height: 48px; background: rgba(0,0,0,0.7); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="margin-left: 3px;"><path d="M8 5v14l11-7z" fill="#fff"/></svg>
    </div>
  </a>
</div>`;
  }

  // 4. Quoted post (record)
  const record = embed.record;
  if (record) {
    const text = record.value?.text || record.record?.text || '';
    const author = record.author || {};
    const displayName = author.displayName || author.handle || '';
    const handle = author.handle ? `@${author.handle}` : '';
    
    if (text) {
      html += `<br /><br />
<div style="border-left: 3px solid #cbd5e1; padding-left: 12px; margin-left: 4px; color: #475569;">
  <strong>${escapeXml(displayName)}</strong> ${handle ? `<span style="font-size: 12px; color: #94a3b8;">${escapeXml(handle)}</span>` : ''}
  <p style="margin: 4px 0 0 0; font-size: 13px; line-height: 1.5;">${escapeXml(text)}</p>
</div>`;
    }
  }

  // 5. recordWithMedia
  if (embed.media) {
    html += formatEmbedHtml(embed.media, authorDid);
  }
  if (embed.record?.record) {
    html += formatEmbedHtml({ record: embed.record }, authorDid);
  }

  return html;
}

/**
 * Format a Bluesky post's embed payload into Markdown.
 */
export function formatEmbedMarkdown(embed: any, authorDid: string): string {
  if (!embed) return '';
  let md = '';

  const type = embed.$type || '';

  // 1. Images
  if (type === 'app.bsky.embed.images' || type === 'app.bsky.embed.images#view' || Array.isArray(embed.images)) {
    const images = embed.images || [];
    for (const img of images) {
      const src = img.fullsize || img.thumb || (img.image?.ref?.$link ? `https://cdn.bsky.app/img/feed_fullsize/plain/${authorDid}/${img.image.ref.$link}@jpeg` : '');
      if (src) {
        const alt = img.alt || '';
        md += `\n\n![${alt}](${src})`;
      }
    }
  }

  // 2. External Card
  const external = embed.external;
  if (external) {
    const uri = external.uri || '';
    const title = external.title || '';
    const desc = external.description || '';
    
    md += `\n\n[${title || uri}](${uri})`;
    if (desc) {
      md += `\n> ${desc}`;
    }
  }

  // 3. Video
  if (type === 'app.bsky.embed.video' || type === 'app.bsky.embed.video#view') {
    const playlist = embed.playlist || '';
    const thumbUrl = typeof embed.thumbnail === 'string' && embed.thumbnail.startsWith('http')
      ? embed.thumbnail
      : (embed.thumbnail?.ref?.$link ? `https://cdn.bsky.app/img/feed_fullsize/plain/${authorDid}/${embed.thumbnail.ref.$link}@jpeg` : '');
    
    md += `\n\n[Watch Video](${playlist || thumbUrl || '#'})`;
  }

  // 4. Quoted post (record)
  const record = embed.record;
  if (record) {
    const text = record.value?.text || record.record?.text || '';
    const author = record.author || {};
    const displayName = author.displayName || author.handle || 'User';
    const handle = author.handle ? `@${author.handle}` : '';
    
    if (text) {
      md += `\n\n> **${displayName}** (${handle})\n> ${text.replace(/\n/g, '\n> ')}`;
    }
  }

  // 5. recordWithMedia
  if (embed.media) {
    md += formatEmbedMarkdown(embed.media, authorDid);
  }
  if (embed.record?.record) {
    md += formatEmbedMarkdown({ record: embed.record }, authorDid);
  }

  return md;
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
    <docs>http://cyber.law.harvard.edu/rss/rss.html</docs>
    <ttl>5</ttl>${cloudTag}${channelImage}
${itemsXml}
  </channel>
</rss>`;
}

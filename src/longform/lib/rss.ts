/**
 * Reusable RSS feed generator for Longform.
 * Produces RSS 2.0 XML from a list of feed items.
 */

export interface RssFeedItem {
  title: string;
  link: string;
  description: string;
  authorName: string;
  pubDate: string | null;
  guid: string;
}

export interface RssFeedOptions {
  title: string;
  description: string;
  link: string;
  feedUrl: string;
  language?: string;
  items: RssFeedItem[];
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateRssFeed(opts: RssFeedOptions): string {
  const itemsXml = opts.items.map(item => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <description>${escapeXml(item.description)}</description>
      <dc:creator>${escapeXml(item.authorName)}</dc:creator>
      ${item.pubDate ? `<pubDate>${new Date(item.pubDate).toUTCString()}</pubDate>` : ''}
      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
    </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(opts.title)}</title>
    <description>${escapeXml(opts.description)}</description>
    <link>${escapeXml(opts.link)}</link>
    <atom:link href="${escapeXml(opts.feedUrl)}" rel="self" type="application/rss+xml" />
    <language>${opts.language || 'en'}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>Longform RSS</generator>
${itemsXml}
  </channel>
</rss>`;
}

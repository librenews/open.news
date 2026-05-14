/**
 * Reusable RSS feed generator for Longform.
 * Produces RSS 2.0 XML with rich metadata (media, content, Dublin Core).
 */

export interface RssFeedItem {
  title: string;
  link: string;
  description: string;
  authorName: string;
  authorUri?: string;
  pubDate: string | null;
  guid: string;
  imageUrl?: string | null;
  wordCount?: number;
  categories?: string[];
  contentHtml?: string | null;
}

export interface RssFeedOptions {
  title: string;
  description: string;
  link: string;
  feedUrl: string;
  language?: string;
  imageUrl?: string;
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
  const itemsXml = opts.items.map(item => {
    const categories = (item.categories || [])
      .map(c => `      <category>${escapeXml(c)}</category>`)
      .join('\n');

    const enclosure = item.imageUrl
      ? `      <enclosure url="${escapeXml(item.imageUrl)}" type="image/jpeg" length="0" />\n      <media:content url="${escapeXml(item.imageUrl)}" medium="image" />\n      <media:thumbnail url="${escapeXml(item.imageUrl)}" />`
      : '';

    const contentEncoded = item.contentHtml
      ? `      <content:encoded><![CDATA[${item.contentHtml}]]></content:encoded>`
      : item.description
        ? `      <content:encoded><![CDATA[<p>${escapeXml(item.description)}</p>]]></content:encoded>`
        : '';

    const wordCountMeta = item.wordCount
      ? `      <slash:comments>0</slash:comments>\n      <!-- wordCount: ${item.wordCount} -->`
      : '';

    return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <description>${escapeXml(item.description)}</description>
      <dc:creator>${escapeXml(item.authorName)}</dc:creator>
${item.authorUri ? `      <author>${escapeXml(item.authorUri)}</author>` : ''}
${item.pubDate ? `      <pubDate>${new Date(item.pubDate).toUTCString()}</pubDate>` : ''}
      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
${enclosure}
${categories}
${contentEncoded}
${wordCountMeta}
    </item>`;
  }).join('\n');

  const channelImage = opts.imageUrl ? `
    <image>
      <url>${escapeXml(opts.imageUrl)}</url>
      <title>${escapeXml(opts.title)}</title>
      <link>${escapeXml(opts.link)}</link>
    </image>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:media="http://search.yahoo.com/mrss/"
  xmlns:slash="http://purl.org/rss/1.0/modules/slash/">
  <channel>
    <title>${escapeXml(opts.title)}</title>
    <description>${escapeXml(opts.description)}</description>
    <link>${escapeXml(opts.link)}</link>
    <atom:link href="${escapeXml(opts.feedUrl)}" rel="self" type="application/rss+xml" />
    <language>${opts.language || 'en'}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>Longform RSS</generator>
    <docs>https://www.rssboard.org/rss-specification</docs>
    <ttl>5</ttl>${channelImage}
${itemsXml}
  </channel>
</rss>`;
}

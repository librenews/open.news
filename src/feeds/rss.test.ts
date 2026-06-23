import { describe, it, expect } from 'vitest';
import {
  leafletToMarkdown,
  applyMarkdownFacets,
  getPostImageUrl,
  generateRssFeed
} from './rss.js';

describe('rss feed utility functions', () => {
  describe('applyMarkdownFacets', () => {
    it('should format simple bold and italic correctly', () => {
      const text = 'hello world';
      const facets = [
        {
          index: { byteStart: 0, byteEnd: 5 },
          features: [{ $type: 'pub.leaflet.richtext.facet#bold' }]
        },
        {
          index: { byteStart: 6, byteEnd: 11 },
          features: [{ $type: 'pub.leaflet.richtext.facet#italic' }]
        }
      ];
      expect(applyMarkdownFacets(text, facets)).toBe('**hello** _world_');
    });

    it('should format links correctly', () => {
      const text = 'click here to search';
      const facets = [
        {
          index: { byteStart: 6, byteEnd: 10 },
          features: [{ $type: 'pub.leaflet.richtext.facet#link', uri: 'https://google.com' }]
        }
      ];
      expect(applyMarkdownFacets(text, facets)).toBe('click [here](https://google.com) to search');
    });

    it('should correctly handle multi-byte characters with byte-based indices', () => {
      // 'hello 🌍 world' -> '🌍' is 4 bytes: F0 9F 8C 8E
      // 'hello ' is 6 bytes.
      // '🌍' is at byte 6, ends at byte 10.
      // ' world' starts at byte 10.
      const text = 'hello 🌍 world';
      const facets = [
        {
          index: { byteStart: 6, byteEnd: 10 },
          features: [{ $type: 'pub.leaflet.richtext.facet#bold' }]
        }
      ];
      expect(applyMarkdownFacets(text, facets)).toBe('hello **🌍** world');
    });

    it('should handle nested formatting properly', () => {
      const text = 'nested';
      const facets = [
        {
          index: { byteStart: 0, byteEnd: 6 },
          features: [{ $type: 'pub.leaflet.richtext.facet#bold' }]
        },
        {
          index: { byteStart: 0, byteEnd: 6 },
          features: [{ $type: 'pub.leaflet.richtext.facet#italic' }]
        }
      ];
      expect(applyMarkdownFacets(text, facets)).toBe('**_nested_**');
    });
  });

  describe('leafletToMarkdown', () => {
    it('should return raw string content as is', () => {
      expect(leafletToMarkdown('hello raw markdown', 'did:123')).toBe('hello raw markdown');
    });

    it('should serialize leaflet block structures to markdown', () => {
      const leafletDoc = {
        pages: [
          {
            blocks: [
              {
                $type: 'pub.leaflet.blocks.header',
                level: 1,
                plaintext: 'Header 1'
              },
              {
                $type: 'pub.leaflet.blocks.text',
                plaintext: 'Paragraph text with bold word',
                facets: [
                  {
                    index: { byteStart: 20, byteEnd: 24 },
                    features: [{ $type: 'pub.leaflet.richtext.facet#bold' }]
                  }
                ]
              },
              {
                $type: 'pub.leaflet.blocks.blockquote',
                plaintext: 'A blockquote'
              },
              {
                $type: 'pub.leaflet.blocks.code',
                language: 'javascript',
                plaintext: 'console.log("hello");'
              },
              {
                $type: 'pub.leaflet.blocks.separator'
              },
              {
                $type: 'pub.leaflet.blocks.image',
                alt: 'My Alt Text',
                image: {
                  ref: { $link: 'bafkreib...' }
                }
              }
            ]
          }
        ]
      };

      const md = leafletToMarkdown(leafletDoc, 'did:plc:user123');
      expect(md).toContain('# Header 1');
      expect(md).toContain('Paragraph text with **bold** word');
      expect(md).toContain('> A blockquote');
      expect(md).toContain('```javascript\nconsole.log("hello");\n```');
      expect(md).toContain('---');
      expect(md).toContain('![My Alt Text](https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:user123/bafkreib...@jpeg)');
    });
  });

  describe('getPostImageUrl', () => {
    it('should extract first image from app.bsky.embed.images', () => {
      const embed = {
        $type: 'app.bsky.embed.images',
        images: [
          {
            image: { ref: { $link: 'cid123' } },
            alt: 'alt text'
          }
        ]
      };
      const url = getPostImageUrl(embed, 'did:plc:foo');
      expect(url).toBe('https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:foo/cid123@jpeg');
    });

    it('should extract thumbnail from app.bsky.embed.external', () => {
      const embed = {
        external: {
          uri: 'https://example.com',
          thumb: { ref: { $link: 'thumb123' } }
        }
      };
      const url = getPostImageUrl(embed, 'did:plc:foo');
      expect(url).toBe('https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:foo/thumb123@jpeg');
    });

    it('should extract direct string thumbnail url from external view', () => {
      const embed = {
        $type: 'app.bsky.embed.external#view',
        external: {
          uri: 'https://example.com',
          thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:foo/thumb123'
        }
      };
      const url = getPostImageUrl(embed, 'did:plc:foo');
      expect(url).toBe('https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:foo/thumb123');
    });

    it('should extract direct string fullsize/thumbnail url from image view', () => {
      const embed = {
        $type: 'app.bsky.embed.images#view',
        images: [
          {
            fullsize: 'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:foo/img123',
            thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:foo/img123',
            alt: 'alt'
          }
        ]
      };
      const url = getPostImageUrl(embed, 'did:plc:foo');
      expect(url).toBe('https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:foo/img123');
    });

    it('should extract direct string thumbnail url from video view', () => {
      const embed = {
        $type: 'app.bsky.embed.video#view',
        playlist: 'https://video.bsky.app/playlist.m3u8',
        thumbnail: 'https://video.bsky.app/thumb123'
      };
      const url = getPostImageUrl(embed, 'did:plc:foo');
      expect(url).toBe('https://video.bsky.app/thumb123');
    });
  });

  describe('generateRssFeed', () => {
    it('should build valid RSS XML with namespaces and cloud options', () => {
      const opts = {
        title: 'Test Feed',
        description: 'Test Feed Desc',
        link: 'https://feeds.social',
        feedUrl: 'https://feeds.social/feed/test.rss',
        cloudUrl: 'https://feeds.social/pleaseNotify',
        items: [
          {
            title: 'Test Item',
            link: 'https://feeds.social/item/1',
            description: '<p>item desc</p>',
            authorName: 'Alice',
            authorUri: 'at://did:123',
            pubDate: '2026-06-23T10:00:00Z',
            guid: 'at://did:123/post/1',
            imageUrl: 'https://cdn.bsky.app/img/foo.jpg',
            markdown: '# Markdown Title\n\nSome text'
          }
        ]
      };

      const xml = generateRssFeed(opts);
      expect(xml).toContain('<rss version="2.0"');
      expect(xml).toContain('xmlns:source="https://source.scripting.com/"');
      expect(xml).toContain('<cloud domain="feeds.social" port="443" path="/pleaseNotify" registerProcedure="" protocol="http-post" />');
      expect(xml).toContain('<title>Test Feed</title>');
      expect(xml).toContain('<dc:creator>Alice</dc:creator>');
      expect(xml).toContain('<guid isPermaLink="false">at://did:123/post/1</guid>');
      expect(xml).toContain('<enclosure url="https://cdn.bsky.app/img/foo.jpg" type="image/jpeg" length="0" />');
      expect(xml).toContain('<source:markdown><![CDATA[# Markdown Title\n\nSome text]]></source:markdown>');
    });
  });
});

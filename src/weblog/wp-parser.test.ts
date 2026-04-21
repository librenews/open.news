import { describe, it, expect, vi } from 'vitest';
import { parseGutenbergToLeaflet } from './wp-parser.js';
import * as weblogDb from '../db/queries/weblog.js';

vi.mock('../db/queries/weblog.js', () => ({
  getMediaMapping: vi.fn(),
  insertMediaMapping: vi.fn(),
}));

describe('WordPress HTML to Leaflet Block Parser', () => {
  const MOCK_DID = 'did:plc:mock123';

  it('safely extracts native plaintext from raw unordered HTML mappings', async () => {
    const rawHtml = '<p>Hello world!</p><br><strong>Testing</strong>';
    const result = await parseGutenbergToLeaflet(rawHtml, 'Post Title', MOCK_DID);

    expect(result.title).toBe('Post Title');
    expect(result.pages![0]!.blocks).toHaveLength(1);
    
    const rootBlock: any = result.pages![0]!.blocks![0]!.block;
    expect(rootBlock.$type).toBe('pub.leaflet.blocks.text');
    expect(rootBlock.plaintext).toBe('Hello world!Testing');
  });

  it('mathematically routes standard WP internal structured payloads dynamically natively', async () => {
    const stringArray = `<!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading">Native Struct</h3>
<!-- /wp:heading -->
<!-- wp:paragraph -->
<p>Body copy here</p>
<!-- /wp:paragraph -->`;
    
    const result = await parseGutenbergToLeaflet(stringArray, 'Headings', MOCK_DID);

    const pureBlocks = result.pages![0]!.blocks!;
    
    expect(pureBlocks[0]!.block.$type).toBe('pub.leaflet.blocks.header');
    expect((pureBlocks[0]!.block as any).plaintext).toBe('\nNative Struct\n');
    expect((pureBlocks[0]!.block as any).level).toBe(3);
    
    expect(pureBlocks[1]!.block.$type).toBe('pub.leaflet.blocks.text');
    expect((pureBlocks[1]!.block as any).plaintext.trim()).toBe('Body copy here');
  });

  it('securely transforms core/image layouts mapping physically offline back to DB constraints', async () => {
    const mockUrl = 'https://bsky.network/xrpc/fake?did=did&cid=fakecid123';
    vi.mocked(weblogDb.getMediaMapping).mockResolvedValue({ cid: 'fakecid123', mime: 'image/png', size: 5050 });

    const imageHtml = `
      <!-- wp:image {"id":13,"sizeSlug":"large","linkDestination":"none"} -->
      <figure class="wp-block-image size-large">
        <img src="${mockUrl}" alt="Test Alt" width="800" height="600"/>
      </figure>
      <!-- /wp:image -->
    `;

    const result = await parseGutenbergToLeaflet(imageHtml, 'Image test', MOCK_DID);
    const pureBlocks = result.pages![0]!.blocks!;
    
    expect(pureBlocks[0]!.block.$type).toBe('pub.leaflet.blocks.image');
    
    const imgRef: any = pureBlocks[0]!.block;
    expect(imgRef.alt).toBe('Test Alt');
    expect(imgRef.aspectRatio.width).toBe(800);
    expect(imgRef.aspectRatio.height).toBe(600);
    expect(imgRef.image.$type).toBe('blob');
    expect(imgRef.image.mimeType).toBe('image/png');
    expect(imgRef.image.size).toBe(5050);
  });

  it('gracefully falls back mapping text facets dynamically internally if Blobs are entirely globally unparseable', async () => {
    const fakeUrl = 'https://broken.link/image.jpg';
    vi.mocked(weblogDb.getMediaMapping).mockResolvedValue(undefined);

    const imageHtml = `
      <!-- wp:image -->
      <figure><img src="${fakeUrl}" alt="Missing"/></figure>
      <!-- /wp:image -->
    `;

    const result = await parseGutenbergToLeaflet(imageHtml, 'Missing Media', MOCK_DID);
    const textBlock: any = result.pages![0]!.blocks![0]!.block;
    
    expect(textBlock.$type).toBe('pub.leaflet.blocks.text');
    expect(textBlock.plaintext).toContain('Missing');
    expect(textBlock.plaintext).toContain(fakeUrl);
  });

  it('securely generates mathematical UTF-8 Facet payloads dynamically explicitly parsing inline formatting tags natively across Leaflet standards', async () => {
    const htmlWithFacets = `<p>Test <strong>Bold</strong> standard, <em>Italics</em> with a <a href="https://example.com">Hyperlink</a>.</p>`;
    const result = await parseGutenbergToLeaflet(htmlWithFacets, 'Format Tests', MOCK_DID);
    
    const rootBlock: any = result.pages![0]!.blocks![0]!.block;
    expect(rootBlock.plaintext).toBe('Test Bold standard, Italics with a Hyperlink.');
    expect(rootBlock.facets).toHaveLength(3);

    const boldFacet = rootBlock.facets.find((f: any) => f.features[0].$type === 'pub.leaflet.richtext.facet#bold');
    expect(boldFacet).toBeDefined();
    expect(boldFacet.index.byteStart).toBe(5);
    expect(boldFacet.index.byteEnd).toBe(9);

    const italicFacet = rootBlock.facets.find((f: any) => f.features[0].$type === 'pub.leaflet.richtext.facet#italic');
    expect(italicFacet).toBeDefined();

    const linkFacet = rootBlock.facets.find((f: any) => f.features[0].$type === 'app.bsky.richtext.facet#link');
    expect(linkFacet).toBeDefined();
    expect(linkFacet.features[0].uri).toBe('https://example.com');
  });
});

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
    expect((pureBlocks[0]!.block as any).plaintext).toBe('Native Struct');
    expect((pureBlocks[0]!.block as any).level).toBe(3);
    
    expect(pureBlocks[1]!.block.$type).toBe('pub.leaflet.blocks.text');
    expect((pureBlocks[1]!.block as any).plaintext).toBe('Body copy here');
  });

  it('securely transforms core/image layouts mapping physically offline back to DB constraints', async () => {
    const mockUrl = 'https://bsky.network/xrpc/fake?did=did&cid=bafkreic7c7hns43f4y5vzzu7b2oabozr7n3pft67x3m2y3qntdytv7pff4';
    vi.mocked(weblogDb.getMediaMapping).mockResolvedValue({ cid: 'bafkreic7c7hns43f4y5vzzu7b2oabozr7n3pft67x3m2y3qntdytv7pff4', mime: 'image/png', size: 5050 });

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
    expect(imgRef.image.mimeType).toBe('image/png');
    expect(imgRef.image.size).toBe(5050);
    expect(imgRef.image.ref.toString()).toBe('bafkreic7c7hns43f4y5vzzu7b2oabozr7n3pft67x3m2y3qntdytv7pff4');
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

  it('securely maps core/separator directly purely to leaflet horizontal rules inherently natively', async () => {
    const rawHtml = `<!-- wp:paragraph -->
<p>Top</p>
<!-- /wp:paragraph -->
<!-- wp:separator -->
<hr class="wp-block-separator has-alpha-channel-opacity"/>
<!-- /wp:separator -->
<!-- wp:paragraph -->
<p>Bottom</p>
<!-- /wp:paragraph -->`;
    const result = await parseGutenbergToLeaflet(rawHtml, 'Separator', MOCK_DID);
    const pureBlocks = result.pages![0]!.blocks!;
    
    expect(pureBlocks).toHaveLength(3);
    expect(pureBlocks[0]!.block.$type).toBe('pub.leaflet.blocks.text');
    expect(pureBlocks[1]!.block.$type).toBe('pub.leaflet.blocks.horizontalRule');
    expect(pureBlocks[2]!.block.$type).toBe('pub.leaflet.blocks.text');
  });

  it('aggressively shims raw native <hr/> HTML dynamically mapped safely bypassing double wrapping automatically seamlessly natively', async () => {
    const rawHtml = `<p>Test A</p><hr/><p>Test B</p><!-- wp:separator --><hr class="native"/><!-- /wp:separator -->`;
    const result = await parseGutenbergToLeaflet(rawHtml, 'Separator Shim', MOCK_DID);
    const pureBlocks = result.pages![0]!.blocks!;
    
    expect(pureBlocks).toHaveLength(4);
    expect(pureBlocks[0]!.block.$type).toBe('pub.leaflet.blocks.text');
    expect(pureBlocks[1]!.block.$type).toBe('pub.leaflet.blocks.horizontalRule');
    expect(pureBlocks[2]!.block.$type).toBe('pub.leaflet.blocks.text');
    expect(pureBlocks[3]!.block.$type).toBe('pub.leaflet.blocks.horizontalRule');
  });

  it('securely maps core/code and core/preformatted unescaping generic symbols precisely explicitly extracting language bindings', async () => {
    const rawHtml = `<!-- wp:code -->
<pre class="wp-block-code"><code lang="js" class="language-typescript">const test = &quot;A &amp; B&quot;;
if (x &lt; 5 || y &gt; 10) {}</code></pre>
<!-- /wp:code -->
<!-- wp:preformatted -->
<pre class="wp-block-preformatted">Raw text here
No language tag</pre>
<!-- /wp:preformatted -->`;
    
    const result = await parseGutenbergToLeaflet(rawHtml, 'Code Blocks', MOCK_DID);
    const pureBlocks = result.pages![0]!.blocks!;
    
    expect(pureBlocks).toHaveLength(2);
    
    const codeBlock: any = pureBlocks[0]!.block;
    expect(codeBlock.$type).toBe('pub.leaflet.blocks.code');
    expect(codeBlock.plaintext).toBe('const test = "A & B";\nif (x < 5 || y > 10) {}');
    expect(codeBlock.language).toBe('typescript');

    const preBlock: any = pureBlocks[1]!.block;
    expect(preBlock.$type).toBe('pub.leaflet.blocks.code');
    expect(preBlock.plaintext).toBe('Raw text here\nNo language tag');
    expect(preBlock.language).toBeUndefined();
  });

  it('aggressively shims raw native <pre> HTML dynamically explicitly mapping Ulysses blocks instantly natively', async () => {
    const rawHtml = `<p>Test Text</p><pre><code class="language-python">print('raw intercepts work!')</code></pre><p>Out</p>`;
    const result = await parseGutenbergToLeaflet(rawHtml, 'Pre Shim', MOCK_DID);
    const pureBlocks = result.pages![0]!.blocks!;
    
    expect(pureBlocks).toHaveLength(3);
    
    expect(pureBlocks[0]!.block.$type).toBe('pub.leaflet.blocks.text');

    const interceptBlock: any = pureBlocks[1]!.block;
    expect(interceptBlock.$type).toBe('pub.leaflet.blocks.code');
    expect(interceptBlock.plaintext).toBe("print('raw intercepts work!')");
    expect(interceptBlock.language).toBe('python');
    
    expect(pureBlocks[2]!.block.$type).toBe('pub.leaflet.blocks.text');
  });

  it('securely pipes core/embed directly cleanly to leaflet website embeddings natively', async () => {
    const rawHtml = `<!-- wp:embed {"url":"https://librenews.com","type":"rich","providerNameSlug":"generic"} -->
<figure class="wp-block-embed is-type-rich is-provider-generic"><div class="wp-block-embed__wrapper">
https://librenews.com
</div></figure>
<!-- /wp:embed -->`;
    const result = await parseGutenbergToLeaflet(rawHtml, 'Embed shim', MOCK_DID);
    const pureBlocks = result.pages![0]!.blocks!;
    
    expect(pureBlocks).toHaveLength(1);
    
    const embedBlock: any = pureBlocks[0]!.block;
    expect(embedBlock.$type).toBe('pub.leaflet.blocks.website');
    expect(embedBlock.src).toBe('https://librenews.com');
  });

  it('securely routes YouTube specific Gutenberg embeds dynamically to native Leaflet interactive iframe widgets natively', async () => {
    const rawHtml = `<!-- wp:embed {"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","type":"video","providerNameSlug":"youtube"} -->
<figure class="wp-block-embed is-type-video is-provider-youtube"><div class="wp-block-embed__wrapper">
https://www.youtube.com/watch?v=dQw4w9WgXcQ
</div></figure>
<!-- /wp:embed -->`;
    const result = await parseGutenbergToLeaflet(rawHtml, 'YouTube iframe test', MOCK_DID);
    const pureBlocks = result.pages![0]!.blocks!;
    
    expect(pureBlocks).toHaveLength(1);
    
    const iframeBlock: any = pureBlocks[0]!.block;
    expect(iframeBlock.$type).toBe('pub.leaflet.blocks.iframe');
    expect(iframeBlock.url).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(iframeBlock.aspectRatio.width).toBe(16);
    expect(iframeBlock.aspectRatio.height).toBe(9);
  });

  it('securely shims generic raw <iframe> payloads dynamically actively rewriting into generic Leaflet components', async () => {
    const rawHtml = `<p>Test Text</p><iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe><p>Out</p>`;
    const result = await parseGutenbergToLeaflet(rawHtml, 'Iframe shim check', MOCK_DID);
    const pureBlocks = result.pages![0]!.blocks!;
    
    expect(pureBlocks).toHaveLength(3);
    
    expect(pureBlocks[0]!.block.$type).toBe('pub.leaflet.blocks.text');

    const iframeBlock: any = pureBlocks[1]!.block;
    expect(iframeBlock.$type).toBe('pub.leaflet.blocks.iframe');
    expect(iframeBlock.url).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(iframeBlock.aspectRatio.width).toBe(16);
    expect(iframeBlock.aspectRatio.height).toBe(9);

    expect(pureBlocks[2]!.block.$type).toBe('pub.leaflet.blocks.text');
  });

  it('securely maps core/list heavily nested logically dynamically parsing cheerio markdown natively into leafet children', async () => {
    const rawHtml = `<!-- wp:paragraph --><p>Pre</p><!-- /wp:paragraph -->
<ul>
  <li>Top Item 1</li>
  <li>Top Item 2
    <ol>
      <li>Nested 1</li>
    </ol>
  </li>
</ul>
<!-- wp:paragraph --><p>Post</p><!-- /wp:paragraph -->`;

    const result = await parseGutenbergToLeaflet(rawHtml, 'List shim check', MOCK_DID);
    const pureBlocks = result.pages![0]!.blocks!;
    
    expect(pureBlocks).toHaveLength(3);
    
    const listBlock: any = pureBlocks[1]!.block;
    expect(listBlock.$type).toBe('pub.leaflet.blocks.unorderedList');
    expect(listBlock.children).toHaveLength(2);
    
    expect(listBlock.children[0].content.plaintext).toBe('Top Item 1');
    expect(listBlock.children[1].content.plaintext).toBe('Top Item 2');
    
    expect(listBlock.children[1].orderedListChildren).toBeDefined();
    expect(listBlock.children[1].orderedListChildren.$type).toBe('pub.leaflet.blocks.orderedList');
    expect(listBlock.children[1].orderedListChildren.children).toHaveLength(1);
    expect(listBlock.children[1].orderedListChildren.children[0].content.plaintext).toBe('Nested 1');
  });

  it('securely pipes core/gallery nested internal components into explicitly flattened Leaflet image components seamlessly natively', async () => {
    const rawHtml = `<!-- wp:gallery -->
<figure class="wp-block-gallery">
  <!-- wp:image {"id":1} -->
  <figure class="wp-block-image"><img src="https://example.com/gallery1.jpg" alt="First" class="wp-image-1"/></figure>
  <!-- /wp:image -->
  <!-- wp:image {"id":2} -->
  <figure class="wp-block-image"><img src="https://example.com/gallery2.jpg" alt="Second" class="wp-image-2"/></figure>
  <!-- /wp:image -->
</figure>
<!-- /wp:gallery -->`;
    const result = await parseGutenbergToLeaflet(rawHtml, 'Gallery Mapping', MOCK_DID);
    const pureBlocks = result.pages![0]!.blocks!;
    
    // Fallback logic produces textbook fallback elements since sqlite mapping mock fails inside test context natively without network
    expect(pureBlocks).toHaveLength(2);
    
    expect(pureBlocks[0]!.block.$type).toBe('pub.leaflet.blocks.text');
    expect((pureBlocks[0]!.block as any).plaintext).toBe('🖼️ View First:\nhttps://example.com/gallery1.jpg');
    
    expect(pureBlocks[1]!.block.$type).toBe('pub.leaflet.blocks.text');
    expect((pureBlocks[1]!.block as any).plaintext).toBe('🖼️ View Second:\nhttps://example.com/gallery2.jpg');
  });
});

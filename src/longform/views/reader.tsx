import { html, raw } from 'hono/html';
import { LeafletDocument, LeafletBlock } from '../../weblog/lexicons.js';

function renderFacets(plaintext: string, facets: any[]) {
  if (!facets || !Array.isArray(facets) || facets.length === 0) return plaintext;
  
  let result = plaintext;
  const isBold = facets.some(f => f?.features?.some?.((feat: any) => feat?.$type === 'pub.leaflet.richtext.facet#bold'));
  const isItalic = facets.some(f => f?.features?.some?.((feat: any) => feat?.$type === 'pub.leaflet.richtext.facet#italic'));
  const linkFacet = facets.find(f => f?.features?.some?.((feat: any) => feat?.$type === 'app.bsky.richtext.facet#link'));
  
  if (isBold) result = `<b>${result}</b>`;
  if (isItalic) result = `<i>${result}</i>`;
  
  if (linkFacet) {
    const linkObj = linkFacet.features.find((feat: any) => feat?.$type === 'app.bsky.richtext.facet#link');
    if (linkObj && linkObj.uri) {
       result = `<a href="${linkObj.uri}" style="color: inherit;">${result}</a>`;
    }
  }
  
  return result;
}

function renderLeafletBlocks(blocks: LeafletBlock[], did: string) {
  if (!Array.isArray(blocks)) return '';
  return blocks.map(b => {
    const block = b.block;
    if (!block) return '';
    
    switch (block.$type) {
      case 'pub.leaflet.blocks.header':
        const level = (block as any).level || 2;
        const text = renderFacets((block as any).plaintext || '', (block as any).facets || []);
        return html`<h${level} style="font-family: var(--font-sans); margin-top: 3rem; margin-bottom: 1.5rem; font-weight: 700; letter-spacing: -0.02em;">${raw(text)}</h${level}>`;
        
      case 'pub.leaflet.blocks.blockquote':
        const quoteText = renderFacets((block as any).plaintext || '', (block as any).facets || []);
        return html`<blockquote style="border-left: 3px solid rgba(0,0,0,0.8); padding-left: 1rem; font-style: italic; margin-left: 0;">${raw(quoteText)}</blockquote>`;
        
      case 'pub.leaflet.blocks.code':
        return html`<pre style="background: #1a1a1a; color: #fff; padding: 1rem; border-radius: 8px; overflow-x: auto; font-family: monospace;"><code>${(block as any).plaintext}</code></pre>`;
        
      case 'pub.leaflet.blocks.image':
        const imageRef = (block as any).image;
        if (!imageRef) return '';
        
        let cid = '';
        if (typeof imageRef === 'string') {
          cid = imageRef;
        } else if (imageRef.ref) {
          if (typeof imageRef.ref === 'string') {
            cid = imageRef.ref;
          } else if (imageRef.ref.$link) {
            cid = imageRef.ref.$link;
          } else if (typeof imageRef.ref.toString === 'function' && imageRef.ref.toString() !== '[object Object]') {
            cid = imageRef.ref.toString();
          }
        }
        
        if (!cid) return '';
        const src = `/blob/${did}/${cid}`;
        return html`<img src="${src}" alt="${(block as any).alt || ''}" style="max-width: 100%; border-radius: 8px; margin: 1.5rem 0; box-shadow: 0 4px 12px rgba(0,0,0,0.1);" />`;
        
      case 'pub.leaflet.blocks.iframe':
        const iframeUrl = (block as any).url;
        if (!iframeUrl) return '';
        return html`
          <div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 8px; margin: 1.5rem 0; background: #1a1a1a;">
            <iframe 
              src="${iframeUrl}" 
              style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;"
              allowfullscreen 
              sandbox="allow-scripts allow-same-origin allow-popups"
            ></iframe>
          </div>
        `;

      case 'pub.leaflet.blocks.website':
        const webUrl = (block as any).src || (block as any).url;
        if (!webUrl) return '';
        try {
           const parsedUrl = new URL(webUrl);
           const domain = parsedUrl.hostname.replace(/^www\./, '');
           return html`
             <a href="${webUrl}" target="_blank" rel="noopener noreferrer" style="display: flex; flex-direction: column; padding: 1.5rem; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; text-decoration: none; color: inherit; margin: 1.5rem 0; transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='rgba(0,0,0,0.02)'" onmouseout="this.style.backgroundColor='transparent'">
               <span style="font-weight: 600; font-family: var(--font-sans); margin-bottom: 0.25rem;">${webUrl}</span>
               <span style="font-size: 14px; color: var(--text-muted); font-family: var(--font-sans);">External Link • ${domain}</span>
             </a>
           `;
        } catch(e) {
           return html`<a href="${webUrl}" style="color: #118156; word-break: break-all;">${webUrl}</a>`;
        }
        
      case 'pub.leaflet.blocks.text':
      default:
        const pText = renderFacets((block as any).plaintext || '', (block as any).facets || []);
        // Handle newlines
        const lines = pText.split('\n').join('<br />');
        return html`<p style="margin-top: 1.25rem; margin-bottom: 1.25rem; min-height: 1.5rem;">${raw(lines)}</p>`;
    }
  });
}

export function ReaderPage(doc: LeafletDocument, authorDid: string, profile: any) {
  const date = new Date(doc.publishedAt || Date.now());
  const formattedDate = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const displayName = profile?.displayName || profile?.handle || authorDid;
  const avatar = profile?.avatar || '';

  let blocks: LeafletBlock[] = [];
  if (doc.pages && doc.pages.length > 0) {
    blocks = (doc.pages[0] as any).blocks || [];
  }

  return html`
    <article class="prose" style="margin-top: 2rem;">
      <header style="margin-bottom: 3rem;">
        <h1 style="font-family: var(--font-sans); font-size: 42px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 1.5rem; line-height: 1.2;">
          ${doc.title}
        </h1>
        
        <div style="display: flex; align-items: center; gap: 1rem; border-top: 1px solid rgba(0,0,0,0.1); border-bottom: 1px solid rgba(0,0,0,0.1); padding: 1rem 0;">
          ${avatar ? html`<img src="${avatar}" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover;" />` : ''}
          <div style="display: flex; flex-direction: column;">
            <span style="font-family: var(--font-sans); font-weight: 600; font-size: 15px;">${displayName}</span>
            <span style="color: var(--text-muted); font-size: 14px; font-family: var(--font-sans);">${formattedDate}</span>
          </div>
        </div>
      </header>
      
      <div class="content">
        ${renderLeafletBlocks(blocks, authorDid)}
      </div>
    </article>
  `;
}

import { parse } from '@wordpress/block-serialization-default-parser';
import { LeafletDocument, LeafletBlock } from './lexicons.js';
import { getMediaMapping } from '../db/queries/weblog.js';

export async function parseGutenbergToLeaflet(content: string, title: string, did: string): Promise<LeafletDocument> {
  // Gracefully shim legacy HTML clients (MarsEdit) dynamically mapped into standard generic Gutenberg logic
  if (!content.includes('<!-- wp:')) {
    content = content.replace(/<img([^>]+)>/gi, (match, attrs) => {
      const srcMatch = attrs.match(/src\s*=\s*(?:["']([^"']+)["']|([^>\s]+))/i);
      const altMatch = attrs.match(/alt\s*=\s*(?:["']([^"']+)["']|([^>\s]+))/i);
      const src = srcMatch ? (srcMatch[1] || srcMatch[2] || '') : '';
      const alt = altMatch ? (altMatch[1] || altMatch[2] || '') : '';
      if (src) {
        return `\n<!-- wp:image -->\n<figure class="wp-block-image"><img src="${src}" alt="${alt}" /></figure>\n<!-- /wp:image -->\n`;
      }
      return match;
    });
  }

  const blocks = parse(content);
  
  const leafletBlocks: LeafletBlock[] = [];
  
  for (const block of blocks as any[]) {
    if (!block.blockName) {
      if (block.innerHTML && block.innerHTML.trim().length > 0) {
        const richText = parseRichText(block.innerHTML);
        leafletBlocks.push({
          $type: 'pub.leaflet.pages.linearDocument#block',
          block: {
            $type: 'pub.leaflet.blocks.text',
            facets: richText.facets,
            plaintext: richText.plaintext
          }
        });
      }
      continue;
    }

    switch (block.blockName) {
      case 'core/paragraph':
      case 'core/freeform':
      case 'core/html': {
        const richText = parseRichText(block.innerHTML);
        leafletBlocks.push({
          $type: 'pub.leaflet.pages.linearDocument#block',
          block: {
            $type: 'pub.leaflet.blocks.text',
            facets: richText.facets,
            plaintext: richText.plaintext
          }
        });
        break;
      }
      case 'core/heading': {
        const richText = parseRichText(block.innerHTML);
        leafletBlocks.push({
          $type: 'pub.leaflet.pages.linearDocument#block',
          block: {
            $type: 'pub.leaflet.blocks.header',
            level: block.attrs?.level || 2,
            facets: richText.facets,
            plaintext: richText.plaintext
          } as any // Using any for extending base interface
        });
        break;
      }
      case 'core/quote': {
        const richText = parseRichText(block.innerHTML);
        leafletBlocks.push({
          $type: 'pub.leaflet.pages.linearDocument#block',
          block: {
            $type: 'pub.leaflet.blocks.blockquote',
            facets: richText.facets,
            plaintext: richText.plaintext
          } as any
        });
        break;
      }
      case 'core/image': {
        const urlMatch = block.innerHTML.match(/<img[^>]+src=["']([^"']+)["']/i);
        const url = urlMatch ? urlMatch[1] : '';
        const altMatch = block.innerHTML.match(/alt=["']([^"']*)["']/i);
        const alt = altMatch && altMatch[1] ? altMatch[1] : 'Image attachment';
        
        // Attempt physical SQLite fetch securely bypassing async constraints natively
        let mediaRecord;
        if (url) {
          try {
            mediaRecord = await getMediaMapping(url);
          } catch (err) {
            console.warn('Parser failed finding Blob reference for Leaflet mapping organically:', err);
          }
          
          // Network fallback if database mapping is completely unavailable (e.g. database dropped or server migrated)
          if (!mediaRecord) {
            const pathMatch = url.match(/\/m\/([^\/]+)\/([^\/]+)\/media\.jpg$/i);
            if (pathMatch) {
              const urlDid = pathMatch[1];
              const urlCid = pathMatch[2];
              try {
                // Fetch headers from PDS securely falling back to public generic sync endpoints dynamically
                const res = await fetch(`https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${urlDid}&cid=${urlCid}`, { method: 'HEAD' });
                if (res.ok) {
                  const contentLen = res.headers.get('content-length');
                  const contentType = res.headers.get('content-type') || 'image/jpeg';
                  if (contentLen) {
                    mediaRecord = {
                      cid: urlCid,
                      mime: contentType,
                      size: parseInt(contentLen, 10)
                    };
                    console.log(`Stateless fallback successful: natively resolving size (${mediaRecord.size}) for CID ${urlCid}`);
                  }
                }
              } catch (fallbackErr) {
                console.warn('Network fallback extraction structurally failed natively:', fallbackErr);
              }
            }
          }
        }
        
        if (mediaRecord && mediaRecord.cid) {
          // Attempt extracting dimensions gracefully mapping Ulysses sizing natively
          const wMatch = block.innerHTML.match(/width=["'](\d+)["']/i);
          const hMatch = block.innerHTML.match(/height=["'](\d+)["']/i);
          const width = wMatch ? parseInt(wMatch[1]) : 1000;
          const height = hMatch ? parseInt(hMatch[1]) : 1000;
          
          leafletBlocks.push({
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.image',
              alt: alt,
              aspectRatio: {
                width: width,
                height: height
              },
              image: {
                $type: 'blob',
                ref: {
                  $link: mediaRecord.cid
                },
                mimeType: mediaRecord.mime,
                size: mediaRecord.size
              }
            } as any
          });
        } else {
          const fallbackText = url ? `🖼️ View ${alt}:\n${url}` : `[Broken Image Attachment]`;
          leafletBlocks.push({
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.text',
              facets: [],
              plaintext: fallbackText
            }
          });
        }
        break;
      }
      default:
        // Fallback for unsupported blocks
        leafletBlocks.push({
          $type: 'pub.leaflet.pages.linearDocument#block',
          block: {
            $type: 'pub.leaflet.blocks.text',
            facets: [],
            plaintext: `[Unsupported WP block: ${block.blockName}]`
          }
        });
        break;
    }
  }

  // Fallback if empty block array parsing
  if (leafletBlocks.length === 0) {
    leafletBlocks.push({
      $type: 'pub.leaflet.pages.linearDocument#block',
      block: { $type: 'pub.leaflet.blocks.text', facets: [], plaintext: stripHtml(content) }
    });
  }

  const record: any = {
    $type: 'pub.leaflet.document',
    title: title || 'Untitled',
    description: '',
    author: did,
    publishedAt: new Date().toISOString(),
    pages: [
      {
        $type: 'pub.leaflet.pages.linearDocument',
        blocks: leafletBlocks
      }
    ]
  };

  return record as LeafletDocument;
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]*>?/gm, '')
             .replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&');
}

function parseRichText(html: string): { plaintext: string, facets: any[] } {
  if (!html) return { plaintext: '', facets: [] };

  const encoder = new TextEncoder();
  let plaintext = '';
  const facets: any[] = [];
  
  const openTags: { type: string, byteStart: number, uri?: string }[] = [];
  
  const regex = /<(?:(\/)?(strong|b|em|i|a)|a\s+[^>]*href=["']([^"']+)["'][^>]*)>/gi;
  
  let lastIndex = 0;
  let match;
  
  while ((match = regex.exec(html)) !== null) {
    if (match.index > lastIndex) {
      plaintext += stripHtml(html.substring(lastIndex, match.index));
    }
    
    // Check if the regex captured a closing tag block, standard block, or href link mapping logic!
    const isClosing = match[1] === '/';
    // index 2 is standard tag capturing, index 3 is href matched only during an <a ...> string format
    const rawTag = (match[2] || 'a').toLowerCase(); 
    const href = match[3];
    
    const currentByteLength = encoder.encode(plaintext).length;
    
    if (isClosing) {
      let lastMatchIdx = -1;
      for (let idx = openTags.length - 1; idx >= 0; idx--) {
        const t = openTags[idx]?.type;
        if (t === rawTag || 
           (rawTag === 'b' && t === 'strong') || (rawTag === 'strong' && t === 'b') ||
           (rawTag === 'i' && t === 'em') || (rawTag === 'em' && t === 'i')) {
          lastMatchIdx = idx;
          break;
        }
      }
      
      if (lastMatchIdx !== -1) {
        const opened = openTags.splice(lastMatchIdx, 1)[0];
        if (opened && opened.byteStart < currentByteLength) {
          if (opened.type === 'strong' || opened.type === 'b') {
            facets.push({
              index: { byteStart: opened.byteStart, byteEnd: currentByteLength },
              features: [{ $type: 'pub.leaflet.richtext.facet#bold' }]
            });
          } else if (opened.type === 'em' || opened.type === 'i') {
            facets.push({
              index: { byteStart: opened.byteStart, byteEnd: currentByteLength },
              features: [{ $type: 'pub.leaflet.richtext.facet#italic' }]
            });
          } else if (opened.type === 'a' && opened.uri) {
            facets.push({
              index: { byteStart: opened.byteStart, byteEnd: currentByteLength },
              features: [{ $type: 'app.bsky.richtext.facet#link', uri: opened.uri }]
            });
          }
        }
      }
    } else {
      if (href) {
        openTags.push({ type: rawTag, byteStart: currentByteLength, uri: href });
      } else {
        openTags.push({ type: rawTag, byteStart: currentByteLength });
      }
    }
    
    lastIndex = regex.lastIndex;
  }
  
  if (lastIndex < html.length) {
    plaintext += stripHtml(html.substring(lastIndex));
  }
  
  // Trimming the final plaintext forces AT validation mismatch entirely natively! 
  // It physically truncates byte bounds logically constructed without adjusting facet indices. 
  // We MUST map the plaintext absolutely purely mapped!
  return { plaintext, facets };
}

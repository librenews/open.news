import { parse } from '@wordpress/block-serialization-default-parser';
import { LeafletDocument, LeafletBlock } from './lexicons.js';
import { getMediaMapping } from '../db/queries/weblog.js';
import * as cheerio from 'cheerio';
import { BlobRef } from '@atproto/api';
import { CID } from 'multiformats/cid';
import crypto from 'crypto';
import { config } from '../lib/config.js';

export async function parseGutenbergToLeaflet(content: string, title: string, did: string, rkey: string): Promise<LeafletDocument> {
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

  // Globally shim native <hr> tags that aren't wrapped in wp:separator correctly mapped seamlessly dynamically
  content = content.replace(/<!-- wp:separator -->[\s\S]*?<!-- \/wp:separator -->|<hr[^>]*>/gi, (match) => {
    if (match.startsWith('<!--')) return match;
    return `\n<!-- wp:separator -->\n<hr class="wp-block-separator" />\n<!-- /wp:separator -->\n`;
  });

  // Globally shim native <pre> tags (usually MarsEdit or Ulysses generic markdown blocks) seamlessly explicitly without double wrapping inside Gutenberg wrappers
  content = content.replace(/<!-- wp:(?:preformatted|code) -->[\s\S]*?<!-- \/wp:(?:preformatted|code) -->|<pre[^>]*>([\s\S]*?)<\/pre>/gi, (match) => {
    if (match.startsWith('<!--')) return match;
    return `\n<!-- wp:preformatted -->\n${match}\n<!-- /wp:preformatted -->\n`;
  });

  // Globally shim native <iframe> tags dynamically explicitly natively into generic embeds mapped correctly to Leaflet widgets
  content = content.replace(/<iframe[^>]+src=["']([^"']+)["'][^>]*>[\s\S]*?<\/iframe>/gi, (match, src) => {
    return `\n<!-- wp:embed {"url":"${src}"} -->\n<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">\n${src}\n</div></figure>\n<!-- /wp:embed -->\n`;
  });

  // Use Cheerio to safely walk raw HTML payloads (MarsEdit) and shim deeply nested <ul>/<ol> correctly into explicit core/list wrappers safely!
  if ((content.includes('<ul') || content.includes('<ol')) && !content.includes('<!-- wp:list')) {
    try {
      const $ = cheerio.load(content, null, false);
      $('ul, ol').not('ul ul, ol ol, ul ol, ol ul').each((_, el) => {
        $(el).replaceWith(recursivelyShimLists(el, $));
      });
      content = $.html();
    } catch (err) {
      console.warn('Cheerio native list parsing fallback failed:', err);
    }
  }

  const blocks = parse(content);
  
  const leafletBlocks: LeafletBlock[] = [];

  async function processImageBlock(imgBlock: any) {
    const urlMatch = imgBlock.innerHTML.match(/<img[^>]+src=["']([^"']+)["']/i);
    const url = urlMatch ? urlMatch[1] : '';
    const altMatch = imgBlock.innerHTML.match(/alt=["']([^"']*)["']/i);
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
      const wMatch = imgBlock.innerHTML.match(/width=["'](\d+)["']/i);
      const hMatch = imgBlock.innerHTML.match(/height=["'](\d+)["']/i);
      const width = wMatch ? parseInt(wMatch[1]) : 1000;
      const height = hMatch ? parseInt(hMatch[1]) : 1000;
      
      leafletBlocks.push({
        $type: 'pub.leaflet.pages.linearDocument#block',
        block: {
          $type: 'pub.leaflet.blocks.image',
          alt: alt,
          aspectRatio: { width, height },
          image: new BlobRef(CID.parse(mediaRecord.cid), mediaRecord.mime, mediaRecord.size)
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
  }
  
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
      case 'core/gallery': {
        if (block.innerBlocks) {
          for (const inner of block.innerBlocks) {
            if (inner.blockName === 'core/image') {
              await processImageBlock(inner);
            }
          }
        }
        break;
      }
      case 'core/image': {
        await processImageBlock(block);
        break;
      }
      case 'core/separator': {
        leafletBlocks.push({
          $type: 'pub.leaflet.pages.linearDocument#block',
          block: {
            $type: 'pub.leaflet.blocks.horizontalRule'
          } as any
        });
        break;
      }
      case 'core/code':
      case 'core/preformatted': {
        const langMatch = block.innerHTML.match(/class=["'][^"']*language-([a-zA-Z0-9-]+)[^"']*["']/i);
        const language = langMatch ? langMatch[1] : undefined;
        
        let codeBlock: any = {
          $type: 'pub.leaflet.blocks.code',
          plaintext: stripHtml(block.innerHTML).trim()
        };
        
        if (language) codeBlock.language = language;
        
        leafletBlocks.push({
          $type: 'pub.leaflet.pages.linearDocument#block',
          block: codeBlock
        });
        break;
      }
      case 'core/embed': {
        // WordPress natively stores the embed URL safely inside core/embed dynamically
        const url = block.attrs?.url || stripHtml(block.innerHTML).trim();
        const provider = block.attrs?.providerNameSlug || '';
        
        if (url) {
          // If it's a YouTube video explicitly mapped by Gutenberg (or recognizable natively)
          if (provider === 'youtube' || url.includes('youtube.com') || url.includes('youtu.be')) {
            const videoId = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/i)?.[1];
            if (videoId) {
              leafletBlocks.push({
                $type: 'pub.leaflet.pages.linearDocument#block',
                block: {
                  $type: 'pub.leaflet.blocks.iframe',
                  url: `https://www.youtube.com/embed/${videoId}`,
                  aspectRatio: { width: 16, height: 9 }
                } as any
              });
              break;
            }
          }

          // Generic website unfurl routing seamlessly fallback mappings inherently safely
          leafletBlocks.push({
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.website',
              src: url
            } as any
          });
        }
        break;
      }
      case 'core/list': {
        const isOrdered = block.attrs?.ordered === true || block.innerHTML?.includes('<ol');
        const children = block.innerBlocks?.filter((b: any) => b.blockName === 'core/list-item').map(parseListItem) || [];
        
        if (children.length > 0) {
          leafletBlocks.push({
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: isOrdered ? 'pub.leaflet.blocks.orderedList' : 'pub.leaflet.blocks.unorderedList',
              children: children
            } as any
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
    $type: 'site.standard.document',
    title: title || 'Untitled',
    description: '',
    tags: [],
    site: `https://${config.LONGFORM_DOMAIN || 'longform.social'}`,
    path: `/${rkey}`,
    author: did,
    publishedAt: new Date().toISOString(),
    content: {
      $type: 'pub.leaflet.content',
      pages: [
        {
          id: crypto.randomUUID(),
          $type: 'pub.leaflet.pages.linearDocument',
          blocks: leafletBlocks
        }
      ]
    }
  };

  return record as LeafletDocument;
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]*>?/gm, '')
             .replace(/&nbsp;/g, ' ')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'")
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
  
  // Trimming the final plaintext safely by adjusting facet indices natively!
  const leadingMatch = plaintext.match(/^(\s+)/);
  const leadingBytes = leadingMatch ? encoder.encode(leadingMatch[1]).length : 0;
  const trimmed = plaintext.trim();

  // Shift facets backwards if we chopped off leading whitespace
  if (leadingBytes > 0) {
    for (const facet of facets) {
      facet.index.byteStart = Math.max(0, facet.index.byteStart - leadingBytes);
      facet.index.byteEnd = Math.max(0, facet.index.byteEnd - leadingBytes);
    }
  }

  // Trailing whitespace is also removed by trim(). We must cap facet byteEnds natively!
  const finalByteLength = encoder.encode(trimmed).length;
  for (const facet of facets) {
    facet.index.byteEnd = Math.min(facet.index.byteEnd, finalByteLength);
    facet.index.byteStart = Math.min(facet.index.byteStart, finalByteLength);
  }

  // Filter out facets that were entirely destroyed or collapsed inside the trimmed whitespace
  const validFacets = facets.filter(f => f.index.byteStart < f.index.byteEnd);

  return { plaintext: trimmed, facets: validFacets };
}

function parseListItem(block: any): any {
  const richText = parseRichText(block.innerHTML); 
  
  const listItem: any = {
    content: {
      $type: 'pub.leaflet.blocks.text',
      facets: richText.facets,
      plaintext: richText.plaintext
    }
  };

  if (block.innerBlocks && block.innerBlocks.length > 0) {
    for (const inner of block.innerBlocks) {
      if (inner.blockName === 'core/list') {
        const isOrdered = inner.attrs?.ordered === true || inner.innerHTML?.includes('<ol');
        const children = inner.innerBlocks?.filter((b: any) => b.blockName === 'core/list-item').map(parseListItem) || [];
        
        if (isOrdered) {
          listItem.orderedListChildren = {
            $type: 'pub.leaflet.blocks.orderedList',
            children: children
          };
        } else {
          listItem.children = children;
        }
      }
    }
  }
  
  return listItem;
}

function recursivelyShimLists(el: any, $: any): string {
  const isOrdered = el.tagName.toLowerCase() === 'ol';
  const orderedAttr = isOrdered ? ' {"ordered":true}' : '';
  
  let childrenHtml = '';
  $(el).children('li').each((_: any, li: any) => {
    let liContent = '';
    $(li).contents().each((_idx: any, child: any) => {
      if (child.type === 'tag' && (child.name === 'ul' || child.name === 'ol')) {
        liContent += recursivelyShimLists(child, $);
      } else {
        liContent += $.html(child);
      }
    });
    childrenHtml += `\n<!-- wp:list-item -->\n<li>${liContent.trim()}</li>\n<!-- /wp:list-item -->`;
  });
  
  return `\n<!-- wp:list${orderedAttr} -->\n<${el.tagName} class="wp-block-list">${childrenHtml}\n</${el.tagName}>\n<!-- /wp:list -->\n`;
}

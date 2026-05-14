import { LeafletDocument, LeafletBlock } from '../../weblog/lexicons.js';
import { BlobRef } from '@atproto/api';
import crypto from 'crypto';
import { config } from '../../lib/config.js';

// Exported from Tiptap AST format into Leaflet Linear Document structure natively
export async function serializeTiptapToLeaflet(tiptapJson: any, title: string, did: string, agent: any, rkey: string, publicationUri?: string): Promise<LeafletDocument> {
  const leafletBlocks: LeafletBlock[] = [];
  const encoder = new TextEncoder();

  if (!tiptapJson || !tiptapJson.content) {
    return {
      $type: 'site.standard.document',
      title,
      description: '',
      tags: [],
      site: publicationUri || `https://${config.LONGFORM_DOMAIN || 'longform.social'}`,
      path: publicationUri ? `/${rkey}` : `/post/${did}/${rkey}`,
      author: did,
      publishedAt: new Date().toISOString(),
      content: {
        $type: 'pub.leaflet.content',
        pages: [{ id: crypto.randomUUID(), $type: 'pub.leaflet.pages.linearDocument', blocks: [] }]
      }
    };
  }

  // Helper: extract plain text and facets from an inline content array
  function extractInlineContent(content: any[]): { plaintext: string; facets: any[] } {
    let plaintext = '';
    const facets: any[] = [];
    if (!content) return { plaintext, facets };

    for (const span of content) {
      if (span.type === 'text') {
        const byteStart = encoder.encode(plaintext).length;
        const textBytes = encoder.encode(span.text).length;
        plaintext += span.text;
        const byteEnd = byteStart + textBytes;
        
        if (span.marks) {
          for (const mark of span.marks) {
            if (mark.type === 'bold') {
              facets.push({ index: { byteStart, byteEnd }, features: [{ $type: 'pub.leaflet.richtext.facet#bold' }] });
            } else if (mark.type === 'italic') {
              facets.push({ index: { byteStart, byteEnd }, features: [{ $type: 'pub.leaflet.richtext.facet#italic' }] });
            } else if (mark.type === 'strike') {
              facets.push({ index: { byteStart, byteEnd }, features: [{ $type: 'pub.leaflet.richtext.facet#strikethrough' }] });
            } else if (mark.type === 'link') {
              facets.push({ index: { byteStart, byteEnd }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: mark.attrs?.href }] });
            }
          }
        }
      } else if (span.type === 'hardBreak') {
        plaintext += '\n';
      }
    }
    return { plaintext, facets };
  }

  // Helper: recursively extract all text from any node tree (fallback)
  function extractAllText(node: any): string {
    if (node.type === 'text') return node.text || '';
    if (node.type === 'hardBreak') return '\n';
    if (!node.content) return '';
    return node.content.map((c: any) => extractAllText(c)).join('');
  }

  // Helper: process a list node into Leaflet blocks
  function processListNode(node: any) {
    if (!node.content) return;
    const isOrdered = node.type === 'orderedList';
    const startNum = node.attrs?.start || 1;

    node.content.forEach((listItem: any, idx: number) => {
      if (listItem.type !== 'listItem' || !listItem.content) return;
      
      // A listItem can contain paragraphs, nested lists, etc.
      for (const child of listItem.content) {
        if (child.type === 'paragraph') {
          const { plaintext, facets } = extractInlineContent(child.content);
          const prefix = isOrdered ? `${startNum + idx}. ` : '• ';
          const prefixBytes = encoder.encode(prefix).length;
          
          // Shift all facet byte indices by prefix length
          const shiftedFacets = facets.map((f: any) => ({
            ...f,
            index: { byteStart: f.index.byteStart + prefixBytes, byteEnd: f.index.byteEnd + prefixBytes }
          }));
          
          leafletBlocks.push({
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.text',
              facets: shiftedFacets,
              plaintext: prefix + plaintext
            }
          });
        } else if (child.type === 'bulletList' || child.type === 'orderedList') {
          // Nested list — recurse
          processListNode(child);
        }
      }
    });
  }

  // Main processing
  function processNode(node: any) {
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock') {
      const { plaintext, facets } = extractInlineContent(node.content);

      if (node.type === 'heading') {
        leafletBlocks.push({
          $type: 'pub.leaflet.pages.linearDocument#block',
          block: { $type: 'pub.leaflet.blocks.header', level: node.attrs?.level || 2, facets, plaintext } as any
        });
      } else if (node.type === 'codeBlock') {
        leafletBlocks.push({
          $type: 'pub.leaflet.pages.linearDocument#block',
          block: { $type: 'pub.leaflet.blocks.code', plaintext, language: node.attrs?.language || undefined } as any
        });
      } else {
        leafletBlocks.push({
          $type: 'pub.leaflet.pages.linearDocument#block',
          block: { $type: 'pub.leaflet.blocks.text', facets, plaintext }
        });
      }
    } else if (node.type === 'blockquote') {
      // Blockquote children are usually paragraphs — combine them
      let combinedText = '';
      const combinedFacets: any[] = [];
      if (node.content) {
        for (const child of node.content) {
          if (combinedText) {
            combinedText += '\n';
          }
          const { plaintext, facets } = extractInlineContent(child.content);
          const offset = encoder.encode(combinedText).length;
          combinedFacets.push(...facets.map((f: any) => ({
            ...f,
            index: { byteStart: f.index.byteStart + offset, byteEnd: f.index.byteEnd + offset }
          })));
          combinedText += plaintext;
        }
      }
      leafletBlocks.push({
        $type: 'pub.leaflet.pages.linearDocument#block',
        block: { $type: 'pub.leaflet.blocks.blockquote', facets: combinedFacets, plaintext: combinedText } as any
      });
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      processListNode(node);
    } else if (node.type === 'horizontalRule') {
      leafletBlocks.push({
        $type: 'pub.leaflet.pages.linearDocument#block',
        block: { $type: 'pub.leaflet.blocks.separator' } as any
      });
    } else if (node.type === 'image') {
      const src = node.attrs?.src;
      // Image processing is async, handled separately below
      pendingImages.push({ src, alt: node.attrs?.alt || '', idx: leafletBlocks.length });
      leafletBlocks.push(null as any); // placeholder
    } else if (node.type === 'embed') {
      const src = node.attrs?.src;
      if (!src) return;
      
      const isYoutube = src.includes('youtube.com') || src.includes('youtu.be');
      if (isYoutube) {
        let videoId = '';
        try {
          if (src.includes('youtu.be')) videoId = new URL(src).pathname.slice(1);
          else videoId = new URL(src).searchParams.get('v') || '';
        } catch (e) {}
        if (videoId) {
          leafletBlocks.push({
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: { $type: 'pub.leaflet.blocks.iframe', url: `https://www.youtube.com/embed/${videoId}`, aspectRatio: { width: 16, height: 9 } } as any
          });
          return;
        }
      }
      leafletBlocks.push({
        $type: 'pub.leaflet.pages.linearDocument#block',
        block: { $type: 'pub.leaflet.blocks.website', src } as any
      });
    } else {
      // Fallback: extract text from any unknown node type
      const text = extractAllText(node).trim();
      if (text) {
        leafletBlocks.push({
          $type: 'pub.leaflet.pages.linearDocument#block',
          block: { $type: 'pub.leaflet.blocks.text', facets: [], plaintext: text }
        });
      }
    }
  }

  const pendingImages: { src: string; alt: string; idx: number }[] = [];

  let titleSkipped = false;
  for (const node of tiptapJson.content) {
    if (!titleSkipped && node.type === "heading" && node.attrs?.level === 1) {
      titleSkipped = true;
      continue;
    }
    processNode(node);
  }

  // Process images (async uploads)
  for (const img of pendingImages) {
    const src = img.src;
    try {
      let buffer: Uint8Array;
      let mimeType = 'image/jpeg';
      
      if (src.startsWith('data:')) {
        const parts = src.split(',');
        const match = parts[0].match(/:(.*?);/);
        if (match) mimeType = match[1];
        buffer = new Uint8Array(Buffer.from(parts[1], 'base64'));
      } else {
        const imgRes = await fetch(src);
        if (!imgRes.ok) throw new Error('Image fetch failed');
        mimeType = imgRes.headers.get('content-type') || mimeType;
        buffer = new Uint8Array(await imgRes.arrayBuffer());
      }
      
      const uploadRes = await agent.com.atproto.repo.uploadBlob(buffer, { encoding: mimeType });
      leafletBlocks[img.idx] = {
        $type: 'pub.leaflet.pages.linearDocument#block',
        block: { $type: 'pub.leaflet.blocks.image', alt: img.alt, aspectRatio: { width: 1000, height: 1000 }, image: uploadRes.data.blob } as any
      };
    } catch (e: any) {
      leafletBlocks[img.idx] = {
        $type: 'pub.leaflet.pages.linearDocument#block',
        block: { $type: 'pub.leaflet.blocks.text', facets: [], plaintext: `[Image Upload Error: ${e.message}]` }
      };
    }
  }

  // Remove any null placeholders that somehow remain
  const finalBlocks = leafletBlocks.filter(b => b !== null);

  return {
    $type: 'site.standard.document',
    title,
    description: '',
    tags: [],
    site: publicationUri || `https://${config.LONGFORM_DOMAIN || 'longform.social'}`,
    path: publicationUri ? `/${rkey}` : `/post/${did}/${rkey}`,
    author: did,
    publishedAt: new Date().toISOString(),
    content: {
      $type: 'pub.leaflet.content',
      pages: [
        {
          id: crypto.randomUUID(),
          $type: 'pub.leaflet.pages.linearDocument',
          blocks: finalBlocks
        }
      ]
    }
  };
}

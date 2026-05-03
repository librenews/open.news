import { LeafletDocument, LeafletBlock } from '../../weblog/lexicons.js';
import { BlobRef } from '@atproto/api';
import crypto from 'crypto';
import { config } from '../../lib/config.js';

// Exported from Tiptap AST format into Leaflet Linear Document structure natively
export async function serializeTiptapToLeaflet(tiptapJson: any, title: string, did: string, agent: any, rkey: string): Promise<LeafletDocument> {
  const leafletBlocks: LeafletBlock[] = [];
  const encoder = new TextEncoder();

  if (!tiptapJson || !tiptapJson.content) {
    return {
      $type: 'site.standard.document',
      title,
      description: '',
      tags: [],
      site: `https://${config.LONGFORM_DOMAIN || 'longform.social'}`,
      path: `/${rkey}`,
      author: did,
      publishedAt: new Date().toISOString(),
      content: {
        $type: 'pub.leaflet.content',
        pages: [{ id: crypto.randomUUID(), $type: 'pub.leaflet.pages.linearDocument', blocks: [] }]
      }
    };
  }

  let titleSkipped = false;
  for (const node of tiptapJson.content) {
    // Skip the first H1 heading since it becomes the document title
    if (!titleSkipped && node.type === "heading" && node.attrs?.level === 1) {
      titleSkipped = true;
      continue;
    }
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'blockquote' || node.type === 'codeBlock') {
      let plaintext = '';
      const facets: any[] = [];
      
      if (node.content) {
        for (const span of node.content) {
          if (span.type === 'text') {
            const byteStart = encoder.encode(plaintext).length;
            const textBytes = encoder.encode(span.text).length;
            plaintext += span.text;
            const byteEnd = byteStart + textBytes;
            
            if (span.marks) {
              for (const mark of span.marks) {
                if (mark.type === 'bold') {
                  facets.push({
                    index: { byteStart, byteEnd },
                    features: [{ $type: 'pub.leaflet.richtext.facet#bold' }]
                  });
                } else if (mark.type === 'italic') {
                  facets.push({
                    index: { byteStart, byteEnd },
                    features: [{ $type: 'pub.leaflet.richtext.facet#italic' }]
                  });
                } else if (mark.type === 'strike') {
                  facets.push({
                    index: { byteStart, byteEnd },
                    features: [{ $type: 'pub.leaflet.richtext.facet#strikethrough' }]
                  });
                } else if (mark.type === 'link') {
                  facets.push({
                    index: { byteStart, byteEnd },
                    features: [{ $type: 'app.bsky.richtext.facet#link', uri: mark.attrs?.href }]
                  });
                }
              }
            }
          }
        }
      }

      if (node.type === 'heading') {
         leafletBlocks.push({
           $type: 'pub.leaflet.pages.linearDocument#block',
           block: {
             $type: 'pub.leaflet.blocks.header',
             level: node.attrs?.level || 2,
             facets,
             plaintext
           } as any
         });
      } else if (node.type === 'blockquote') {
         leafletBlocks.push({
           $type: 'pub.leaflet.pages.linearDocument#block',
           block: {
             $type: 'pub.leaflet.blocks.blockquote',
             facets,
             plaintext
           } as any
         });
      } else if (node.type === 'codeBlock') {
         leafletBlocks.push({
           $type: 'pub.leaflet.pages.linearDocument#block',
           block: {
             $type: 'pub.leaflet.blocks.code',
             plaintext,
             language: node.attrs?.language || undefined
           } as any
         });
      } else {
         leafletBlocks.push({
           $type: 'pub.leaflet.pages.linearDocument#block',
           block: {
             $type: 'pub.leaflet.blocks.text',
             facets,
             plaintext
           }
         });
      }
    } else if (node.type === 'image') {
      const src = node.attrs?.src;
      try {
        let buffer: Uint8Array;
        let mimeType = 'image/jpeg';
        
        if (src.startsWith('data:')) {
          // Process Base64 natively from Editor upload
          const parts = src.split(',');
          const match = parts[0].match(/:(.*?);/);
          if (match) mimeType = match[1];
          buffer = new Uint8Array(Buffer.from(parts[1], 'base64'));
        } else {
          // Fallback to URL fetch if they pasted an external link
          const imgRes = await fetch(src);
          if (!imgRes.ok) throw new Error('Image fetch failed');
          mimeType = imgRes.headers.get('content-type') || mimeType;
          buffer = new Uint8Array(await imgRes.arrayBuffer());
        }
        
        // PDS requires standard image formats, webp might be rejected by some PDS
        // But we attempt it regardless since blob endpoints usually accept any binary.
        const uploadRes = await agent.com.atproto.repo.uploadBlob(buffer, { encoding: mimeType });
        
        leafletBlocks.push({
          $type: 'pub.leaflet.pages.linearDocument#block',
          block: {
            $type: 'pub.leaflet.blocks.image',
            alt: node.attrs?.alt || '',
            aspectRatio: { width: 1000, height: 1000 },
            image: uploadRes.data.blob
          } as any
        });
      } catch (e: any) {
        console.error('Image upload failed in leafletExporter:', e);
        leafletBlocks.push({
          $type: 'pub.leaflet.pages.linearDocument#block',
          block: {
            $type: 'pub.leaflet.blocks.text',
            facets: [],
            plaintext: `[Image Upload Error: ${e.message} | Stack: ${e.stack?.split('\n').slice(0, 2).join(' ')}]`
          }
        });
      }
    } else if (node.type === 'embed') {
      const src = node.attrs?.src;
      if (!src) continue;
      
      const isYoutube = src.includes('youtube.com') || src.includes('youtu.be');
      if (isYoutube) {
        // Extract video ID safely
        let videoId = '';
        try {
          if (src.includes('youtu.be')) {
            videoId = new URL(src).pathname.slice(1);
          } else {
            videoId = new URL(src).searchParams.get('v') || '';
          }
        } catch (e) {}

        if (videoId) {
          leafletBlocks.push({
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.iframe',
              url: `https://www.youtube.com/embed/${videoId}`,
              aspectRatio: { width: 16, height: 9 }
            } as any
          });
          continue;
        }
      }
      
      // Generic fallback
      leafletBlocks.push({
        $type: 'pub.leaflet.pages.linearDocument#block',
        block: {
          $type: 'pub.leaflet.blocks.website',
          src: src
        } as any
      });
    }
  }

  return {
    $type: 'site.standard.document',
    title,
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
}

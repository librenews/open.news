import { Database } from '@hocuspocus/extension-database';
import { pool } from '../../db/client.js';
import { resolvePds } from '../../lib/pds.js';
import { BskyAgent } from '@atproto/api';
import { logger } from '../../lib/logger.js';
import * as Y from 'yjs';

function extractTitleFromState(state: Uint8Array): string {
  try {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, state);
    const fragment = ydoc.getXmlFragment('default');
    for (let i = 0; i < fragment.length; i++) {
      const node = fragment.get(i);
      if (node instanceof Y.XmlElement && node.nodeName === 'heading') {
        let text = '';
        for (let j = 0; j < node.length; j++) {
          const child = node.get(j);
          if (child instanceof Y.XmlText) {
            text += child.toString();
          }
        }
        if (text.trim()) return text.trim();
      }
    }
  } catch (e) {
    // If Yjs parsing fails, just return Untitled
  }
  return 'Untitled';
}

/**
 * Convert a Leaflet document record into Tiptap-compatible Yjs state.
 * This enables editing of already-published articles.
 */
function seedYjsFromLeaflet(record: any): Uint8Array {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment('default');

  ydoc.transact(() => {
    // Insert title as H1
    if (record.title) {
      const heading = new Y.XmlElement('heading');
      heading.setAttribute('level', '1');
      const text = new Y.XmlText(record.title);
      heading.insert(0, [text]);
      fragment.insert(fragment.length, [heading]);
    }

    // Convert Leaflet blocks back to Tiptap nodes
    const pages = record.content?.pages || [];
    for (const page of pages) {
      const blocks = page.blocks || [];
      for (const blockWrapper of blocks) {
        const block = blockWrapper.block || blockWrapper;
        const blockType = block.$type || '';

        if (blockType.includes('blocks.text')) {
          const para = new Y.XmlElement('paragraph');
          if (block.plaintext) {
            const text = new Y.XmlText(block.plaintext);
            para.insert(0, [text]);
          }
          fragment.insert(fragment.length, [para]);
        } else if (blockType.includes('blocks.header')) {
          const heading = new Y.XmlElement('heading');
          heading.setAttribute('level', String(block.level || 2));
          if (block.plaintext) {
            const text = new Y.XmlText(block.plaintext);
            heading.insert(0, [text]);
          }
          fragment.insert(fragment.length, [heading]);
        } else if (blockType.includes('blocks.blockquote')) {
          const bq = new Y.XmlElement('blockquote');
          const para = new Y.XmlElement('paragraph');
          if (block.plaintext) {
            const text = new Y.XmlText(block.plaintext);
            para.insert(0, [text]);
          }
          bq.insert(0, [para]);
          fragment.insert(fragment.length, [bq]);
        } else if (blockType.includes('blocks.code')) {
          const code = new Y.XmlElement('codeBlock');
          if (block.language) code.setAttribute('language', block.language);
          if (block.plaintext) {
            const text = new Y.XmlText(block.plaintext);
            code.insert(0, [text]);
          }
          fragment.insert(fragment.length, [code]);
        } else if (blockType.includes('blocks.image')) {
          // Images need a blob URL — insert placeholder
          const para = new Y.XmlElement('paragraph');
          const text = new Y.XmlText(block.alt ? `[Image: ${block.alt}]` : '[Image]');
          para.insert(0, [text]);
          fragment.insert(fragment.length, [para]);
        } else if (block.plaintext) {
          // Fallback for unknown block types with text
          const para = new Y.XmlElement('paragraph');
          const text = new Y.XmlText(block.plaintext);
          para.insert(0, [text]);
          fragment.insert(fragment.length, [para]);
        }
      }
    }

    // Add empty trailing paragraph
    fragment.insert(fragment.length, [new Y.XmlElement('paragraph')]);
  });

  return Y.encodeStateAsUpdate(ydoc);
}

export const hocuspocusDb = new Database({
  fetch: async ({ documentName }) => {
    const { rows } = await pool.query('SELECT data FROM longform_yjs_documents WHERE name = $1', [documentName]);
    if (rows[0] && rows[0].data) {
      return rows[0].data;
    }

    // No Yjs data — if this is an at:// URI, try to seed from PDS record
    if (documentName.startsWith('at://')) {
      try {
        const parts = documentName.replace('at://', '').split('/');
        const did = parts[0];
        const collection = parts[1];
        const rkey = parts[2];

        const pdsUrl = await resolvePds(did);
        const agent = new BskyAgent({ service: pdsUrl }) as any;
        const res = await agent.com.atproto.repo.getRecord({ repo: did, collection, rkey });

        if (res.data?.value) {
          const state = seedYjsFromLeaflet(res.data.value as any);
          // Persist it so subsequent loads are fast
          await pool.query(
            `INSERT INTO longform_yjs_documents (name, data, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (name) DO UPDATE SET data = $2, updated_at = NOW()`,
            [documentName, Buffer.from(state)]
          );
          logger.info({ documentName }, 'Seeded Yjs document from PDS record for editing');
          return state;
        }
      } catch (err) {
        logger.warn({ err, documentName }, 'Failed to seed Yjs document from PDS');
      }
    }

    return null;
  },
  store: async ({ documentName, state }) => {
    await pool.query(
      `INSERT INTO longform_yjs_documents (name, data, updated_at) 
       VALUES ($1, $2, NOW())
       ON CONFLICT (name) DO UPDATE SET data = $2, updated_at = NOW()`,
      [documentName, state]
    );

    // Update title in drafts table if this is an at:// document
    if (documentName.startsWith('at://')) {
      const title = extractTitleFromState(state);
      await pool.query(
        `UPDATE longform_drafts SET title = $1, updated_at = NOW() WHERE document_name = $2 AND published_uri IS NULL`,
        [title, documentName]
      );
    }
  },
});

import { Database } from '@hocuspocus/extension-database';
import { pool } from '../../db/client.js';
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

export const hocuspocusDb = new Database({
  fetch: async ({ documentName }) => {
    const { rows } = await pool.query('SELECT data FROM centipedia_yjs_documents WHERE name = $1', [documentName]);
    if (rows[0] && rows[0].data) {
      return rows[0].data;
    }
    return null;
  },
  store: async ({ documentName, state }) => {
    await pool.query(
      `INSERT INTO centipedia_yjs_documents (name, data, updated_at) 
       VALUES ($1, $2, NOW())
       ON CONFLICT (name) DO UPDATE SET data = $2, updated_at = NOW()`,
      [documentName, state]
    );

    // Update title in drafts table if this is an at:// document
    if (documentName.startsWith('at://')) {
      const title = extractTitleFromState(state);
      await pool.query(
        `UPDATE centipedia_drafts SET title = $1, updated_at = NOW() WHERE document_name = $2 AND published_uri IS NULL`,
        [title, documentName]
      );
    }
  },
});

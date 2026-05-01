import { Database } from '@hocuspocus/extension-database';
import { pool } from '../../db/client.js';

export const hocuspocusDb = new Database({
  fetch: async ({ documentName }) => {
    const { rows } = await pool.query('SELECT data FROM longform_yjs_documents WHERE name = $1', [documentName]);
    if (rows[0] && rows[0].data) {
      return rows[0].data;
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
  },
});

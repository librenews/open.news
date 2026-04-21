import { db } from '../client.js';

export async function insertPostMapping(id: number, uri: string, handle: string, originalContent?: string): Promise<void> {
  const query = `
    INSERT INTO post_mapping (id, uri, handle, original_content)
    VALUES ($1, $2, $3, $4)
  `;
  await db.query(query, [id, uri, handle, originalContent || null]);
}

export async function getPostMapping(id: number): Promise<{ uri: string, original_content?: string } | undefined> {
  const query = `SELECT uri, original_content FROM post_mapping WHERE id = $1`;
  const result = await db.query(query, [id]);
  return result.rows[0] as { uri: string, original_content?: string } | undefined;
}

export async function insertMediaMapping(url: string, cid: string, mime: string, size: number): Promise<void> {
  const query = `
    INSERT INTO media_mapping (url, cid, mime, size)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (url) DO UPDATE SET
      cid = EXCLUDED.cid,
      mime = EXCLUDED.mime,
      size = EXCLUDED.size
  `;
  await db.query(query, [url, cid, mime, size]);
}

export async function getMediaMapping(url: string): Promise<{ cid: string, mime: string, size: number } | undefined> {
  const query = `SELECT cid, mime, size FROM media_mapping WHERE url = $1`;
  const result = await db.query(query, [url]);
  return result.rows[0] as { cid: string, mime: string, size: number } | undefined;
}

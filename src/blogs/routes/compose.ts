import { Hono } from 'hono';
import { Agent } from '@atproto/api';
import { randomBytes } from 'crypto';
import { getBlogsSession, getBlogsAuthClient } from './auth.js';
import { upsertSiteStandardArticle } from '../../db/queries/siteStandard.js';
import { resolvePds } from '../../lib/pds.js';
import { logger } from '../../lib/logger.js';

export const blogsComposeRouter = new Hono();

const BLOGS_DOMAIN = process.env.BLOGS_DOMAIN || 'blogs.social';

function genRkey(): string {
  return randomBytes(10).toString('base64url').slice(0, 13).toLowerCase();
}

blogsComposeRouter.post('/compose', async (c) => {
  const session = await getBlogsSession(c);
  if (!session) return c.redirect('/auth/login');

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.text('Bad request', 400);
  }

  const title = ((formData.get('title') as string) || '').trim() || null;
  const content = ((formData.get('content') as string) || '').trim();

  if (!content && !title) {
    return c.redirect('/');
  }

  // Collect image files (multiple inputs named "images")
  const imageFiles: File[] = [];
  for (const [key, value] of formData.entries()) {
    if (key === 'images' && value instanceof File && value.size > 0) {
      imageFiles.push(value);
    }
  }

  try {
    const client = await getBlogsAuthClient();
    const oauthSession = await client.restore(session.did);
    const agent = new Agent(oauthSession);

    // Resolve user's PDS for blob serving URLs
    let pdsUrl = 'https://bsky.social';
    try { pdsUrl = await resolvePds(session.did); } catch { /* use default */ }

    // Upload images as blobs
    let finalContent = content;
    for (const img of imageFiles) {
      try {
        const buffer = new Uint8Array(await img.arrayBuffer());
        const mimeType = img.type || 'image/jpeg';
        const uploadRes = await agent.com.atproto.repo.uploadBlob(buffer, { encoding: mimeType });
        const cid = (uploadRes.data.blob.ref as any).$link as string;
        const imgUrl = `${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${session.did}&cid=${cid}`;
        const altText = img.name.replace(/\.[^.]+$/, '') || 'image';
        finalContent += `\n\n![${altText}](${imgUrl})`;
      } catch (err) {
        logger.warn({ err, name: img.name }, 'compose: image upload failed, skipping');
      }
    }

    const rkey = genRkey();
    const publishedAt = new Date().toISOString();
    const postPath = `/author/${session.did}/${rkey}`;

    const record: Record<string, unknown> = {
      $type: 'site.standard.document',
      content: finalContent,
      publishedAt,
      createdAt: publishedAt,
      author: session.did,
      site: `https://${BLOGS_DOMAIN}`,
      path: postPath,
    };
    if (title) record.title = title;

    // Write record to user's PDS
    await agent.com.atproto.repo.putRecord({
      repo: session.did,
      collection: 'site.standard.document',
      rkey,
      record,
    });

    // Index locally
    const postUri = `at://${session.did}/site.standard.document/${rkey}`;
    const wordCount = finalContent.trim().split(/\s+/).length;
    const description = finalContent.slice(0, 300) || null;

    await upsertSiteStandardArticle(
      postUri,
      session.did,
      session.handle,
      title,
      description,
      new Date(publishedAt),
      `https://${BLOGS_DOMAIN}`,
      postPath,
      record,
      null,
      wordCount,
      false
    );

    logger.info({ did: session.did, rkey }, 'blogs: compose record created');
    return c.redirect(`/read/${session.did}/${rkey}`);
  } catch (err) {
    logger.error({ err }, 'blogs compose failed');
    return c.redirect('/?compose_error=1');
  }
});

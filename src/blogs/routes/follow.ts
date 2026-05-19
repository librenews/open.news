import { Hono } from 'hono';
import { Agent } from '@atproto/api';
import { randomBytes } from 'crypto';
import { pool } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { getBlogsSession, getBlogsAuthClient } from './auth.js';

export const blogsFollowRouter = new Hono();

// Generate a compact base32-like rkey similar to AT Protocol TIDs
function genRkey(): string {
  return randomBytes(10).toString('base64url').slice(0, 13).toLowerCase();
}

// POST /follow/:did  — create a subscription record on the user's PDS + mirror locally
blogsFollowRouter.post('/follow/:did', async (c) => {
  const session = await getBlogsSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);

  const targetDid = c.req.param('did');
  if (targetDid === session.did) return c.json({ error: 'Cannot follow yourself' }, 400);

  try {
    // Check already following
    const { rows: existing } = await pool.query(
      'SELECT rkey FROM blogs_follows WHERE follower_did = $1 AND following_did = $2',
      [session.did, targetDid]
    );
    if (existing.length > 0) {
      const redirect = c.req.header('referer') || '/';
      return c.redirect(redirect);
    }

    const client = await getBlogsAuthClient();
    const oauthSession = await client.restore(session.did);
    const agent = new Agent(oauthSession);

    const rkey = genRkey();
    const record = {
      $type: 'site.standard.graph.subscription',
      subject: targetDid,
      createdAt: new Date().toISOString(),
    };

    await agent.com.atproto.repo.putRecord({
      repo: session.did,
      collection: 'site.standard.graph.subscription',
      rkey,
      record,
    });

    await pool.query(
      `INSERT INTO blogs_follows (follower_did, following_did, rkey)
       VALUES ($1, $2, $3)
       ON CONFLICT (follower_did, following_did) DO NOTHING`,
      [session.did, targetDid, rkey]
    );

    logger.info({ follower: session.did, following: targetDid }, 'blogs follow created');
  } catch (err) {
    logger.error({ err }, 'blogs follow failed');
  }

  const redirect = c.req.header('referer') || '/';
  return c.redirect(redirect);
});

// POST /unfollow/:did  — delete the subscription record from PDS + mirror
blogsFollowRouter.post('/unfollow/:did', async (c) => {
  const session = await getBlogsSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);

  const targetDid = c.req.param('did');

  try {
    const { rows } = await pool.query(
      'SELECT rkey FROM blogs_follows WHERE follower_did = $1 AND following_did = $2',
      [session.did, targetDid]
    );

    if (rows.length > 0) {
      const rkey = rows[0].rkey;

      const client = await getBlogsAuthClient();
      const oauthSession = await client.restore(session.did);
      const agent = new Agent(oauthSession);

      try {
        await agent.com.atproto.repo.deleteRecord({
          repo: session.did,
          collection: 'site.standard.graph.subscription',
          rkey,
        });
      } catch (err) {
        logger.warn({ err }, 'PDS record delete failed; removing local follow anyway');
      }

      await pool.query(
        'DELETE FROM blogs_follows WHERE follower_did = $1 AND following_did = $2',
        [session.did, targetDid]
      );

      logger.info({ follower: session.did, following: targetDid }, 'blogs follow removed');
    }
  } catch (err) {
    logger.error({ err }, 'blogs unfollow failed');
  }

  const redirect = c.req.header('referer') || '/';
  return c.redirect(redirect);
});

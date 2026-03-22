import { AtpAgent, RichText } from '@atproto/api';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

let _agent: AtpAgent | null = null;

export async function getBotAgent(): Promise<AtpAgent> {
  if (_agent) return _agent;

  const agent = new AtpAgent({ service: config.ATPROTO_PDS_URL });

  if (config.BSKY_BOT_DID && config.BSKY_BOT_PASSWORD) {
    await agent.login({
      identifier: config.BSKY_BOT_DID,
      password: config.BSKY_BOT_PASSWORD,
    });
    logger.info({ did: config.BSKY_BOT_DID }, 'Bot agent logged in');
  } else {
    logger.warn('BSKY_BOT_DID or BSKY_BOT_PASSWORD not set — bot posting disabled');
  }

  _agent = agent;
  return agent;
}

export async function resolveHandle(handle: string): Promise<string | null> {
  try {
    const agent = new AtpAgent({ service: config.ATPROTO_PDS_URL });
    const res = await agent.resolveHandle({ handle });
    return res.data.did;
  } catch {
    return null;
  }
}

export async function getFollowedDids(userDid: string): Promise<
  Array<{ did: string; handle: string; displayName?: string; avatar?: string }>
> {
  const follows: Array<{ did: string; handle: string; displayName?: string; avatar?: string }> = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ actor: userDid, limit: '100' });
    if (cursor) params.set('cursor', cursor);
    // Use the public AppView API — no auth required for public follow graphs
    const url = `https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`getFollows failed: ${res.status} ${res.statusText}`);
    const data = await res.json() as {
      follows: Array<{ did: string; handle: string; displayName?: string; avatar?: string }>;
      cursor?: string;
    };
    for (const f of data.follows) {
      follows.push({ did: f.did, handle: f.handle, displayName: f.displayName, avatar: f.avatar });
    }
    cursor = data.cursor;
  } while (cursor);

  return follows;
}

/**
 * Post a reply to a mention (with auto-detected facets for clickable links).
 */
export async function postReply(params: {
  text: string;
  replyToUri: string;
  replyToCid: string;
}): Promise<void> {
  const agent = await getBotAgent();
  const rt = new RichText({ text: params.text });
  await rt.detectFacets(agent);

  await agent.post({
    text: rt.text,
    facets: rt.facets,
    reply: {
      root: { uri: params.replyToUri, cid: params.replyToCid },
      parent: { uri: params.replyToUri, cid: params.replyToCid },
    },
  });
}

/**
 * Post a new standalone post (with auto-detected facets for clickable links).
 */
export async function postNew(text: string): Promise<void> {
  const agent = await getBotAgent();
  const rt = new RichText({ text });
  await rt.detectFacets(agent);

  await agent.post({ text: rt.text, facets: rt.facets });
}

/**
 * Send a DM reply in a conversation (with auto-detected facets for clickable links).
 */
export async function sendDm(convoId: string, text: string): Promise<void> {
  const agent = await getBotAgent();
  const rt = new RichText({ text });
  await rt.detectFacets(agent);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (agent.api as any).chat.bsky.convo.sendMessage(
    { convoId, message: { text: rt.text, facets: rt.facets } },
    { headers: { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' } },
  );
}

// ─── Chat API helpers for DM polling ─────────────────────────────────────────

export interface ConvoView {
  id: string;
  unreadCount: number;
  lastMessage?: {
    id: string;
    rev: string;
    text: string;
    sender: { did: string };
    sentAt: string;
  };
  members: Array<{ did: string; handle: string; displayName?: string }>;
}

export interface ChatMessage {
  id: string;
  rev: string;
  text: string;
  sender: { did: string };
  sentAt: string;
}

/**
 * List conversations with unread messages.
 */
export async function listConvos(): Promise<ConvoView[]> {
  const agent = await getBotAgent();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (agent.api as any).chat.bsky.convo.listConvos(
    {},
    { headers: { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' } },
  );
  return (res.data.convos ?? []) as ConvoView[];
}

/**
 * Get messages in a conversation, optionally after a cursor.
 */
export async function getConvoMessages(
  convoId: string,
  cursor?: string
): Promise<{ messages: ChatMessage[]; cursor?: string }> {
  const agent = await getBotAgent();
  const params: Record<string, string> = { convoId, limit: '50' };
  if (cursor) params.cursor = cursor;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (agent.api as any).chat.bsky.convo.getMessages(
    params,
    { headers: { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' } },
  );
  return {
    messages: (res.data.messages ?? []) as ChatMessage[],
    cursor: res.data.cursor,
  };
}

/**
 * Mark a conversation as read up to a given message.
 */
export async function markConvoRead(convoId: string): Promise<void> {
  const agent = await getBotAgent();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (agent.api as any).chat.bsky.convo.updateRead(
    { convoId },
    { headers: { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' } },
  );
}

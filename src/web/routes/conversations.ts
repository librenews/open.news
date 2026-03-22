import { Hono } from 'hono';
import {
  getConversationsForUser,
  createConversation,
  getMessages,
  insertMessage,
  isParticipant,
} from '../../db/queries/conversations.js';
import { sseRegistry } from '../sseRegistry.js';
import { processUserMessage, generateBriefing } from '../../services/chatAgent.js';

const app = new Hono();

/** List conversations for the authenticated user. */
app.get('/', async (c) => {
  const userId = c.get('userId' as never) as number;
  const conversations = await getConversationsForUser(userId);
  return c.json({ conversations });
});

/** Create a new conversation. */
app.post('/', async (c) => {
  const userId = c.get('userId' as never) as number;
  const body = await c.req.json<{ visibility?: string }>();
  const conversation = await createConversation(userId, {
    visibility: body.visibility ?? 'private',
  });
  return c.json(conversation, 201);
});

/** Get messages for a conversation (paginated, newest-first). */
app.get('/:id/messages', async (c) => {
  const userId = c.get('userId' as never) as number;
  const conversationId = Number(c.req.param('id'));
  if (!(await isParticipant(conversationId, userId))) {
    return c.json({ error: 'Not found' }, 404);
  }
  const before = c.req.query('before') ?? undefined;
  const limit = Number(c.req.query('limit') ?? '50');
  const messages = await getMessages(conversationId, { limit, before });
  return c.json({ messages });
});

/** Send a user message → enqueue inline bot reply. */
app.post('/:id/messages', async (c) => {
  const userId = c.get('userId' as never) as number;
  const conversationId = Number(c.req.param('id'));
  if (!(await isParticipant(conversationId, userId))) {
    return c.json({ error: 'Not found' }, 404);
  }

  const body = await c.req.json<{ text: string }>();
  const text = body.text?.trim();
  if (!text) return c.json({ error: 'Message text is required' }, 400);

  // Create user message
  const userMessage = await insertMessage({
    conversationId,
    userId,
    role: 'user',
    text,
    isComplete: true,
  });

  // Process bot reply inline (same process as SSE — no worker needed for MVP)
  processUserMessage(conversationId, userId, text).catch((err: unknown) => {
    console.error('Chat agent error:', err);
  });

  return c.json({ message: userMessage }, 201);
});

/** Trigger a proactive news briefing. */
app.post('/:id/briefing', async (c) => {
  const userId = c.get('userId' as never) as number;
  const conversationId = Number(c.req.param('id'));
  if (!(await isParticipant(conversationId, userId))) {
    return c.json({ error: 'Not found' }, 404);
  }

  // Fire-and-forget — briefing streams via SSE
  generateBriefing(conversationId, userId).catch((err: unknown) => {
    console.error('Briefing error:', err);
  });

  return c.json({ status: 'briefing_started' });
});

export default app;

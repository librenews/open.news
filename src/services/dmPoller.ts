import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import { listConvos, getConvoMessages, markConvoRead, type ChatMessage } from './atproto.js';
import { enqueueJob } from '../web/jobEnqueue.js';

const POLL_INTERVAL_MS = 15_000;
const BOT_DID = config.BSKY_BOT_DID;

// Track last-seen message ID per convo to avoid reprocessing
const lastSeenMessageId = new Map<string, string>();

let pollTimer: ReturnType<typeof setInterval> | null = null;
let isPolling = false;

/**
 * Process a single DM conversation: check for new messages, queue bot replies.
 */
async function processConvo(convoId: string, messages: ChatMessage[]): Promise<number> {
  const lastSeen = lastSeenMessageId.get(convoId);
  let processed = 0;

  // Messages come newest-first from the API; reverse to process chronologically
  const chronological = [...messages].reverse();

  for (const msg of chronological) {
    // Skip bot's own messages
    if (msg.sender.did === BOT_DID) continue;

    // Skip already-seen messages
    if (lastSeen && msg.id <= lastSeen) continue;

    // Skip empty messages
    const text = msg.text?.trim();
    if (!text) continue;

    // Queue a bot reply job
    await enqueueJob('botReply', {
      postUri: `dm:${convoId}:${msg.id}`,
      postCid: msg.id,
      senderDid: msg.sender.did,
      text,
      interactionType: 'dm',
      convoId,
    });

    processed++;
    logger.info(
      { convoId, messageId: msg.id, senderDid: msg.sender.did },
      'DM queued for bot reply'
    );
  }

  // Update last-seen to the newest message
  if (messages.length > 0) {
    lastSeenMessageId.set(convoId, messages[0].id);
  }

  return processed;
}

/**
 * Single poll iteration: fetch unread convos, process new messages.
 */
async function pollOnce(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  try {
    const convos = await listConvos();
    const unread = convos.filter((c) => c.unreadCount > 0);

    if (unread.length === 0) {
      isPolling = false;
      return;
    }

    let totalProcessed = 0;

    for (const convo of unread) {
      try {
        const { messages } = await getConvoMessages(convo.id);
        const count = await processConvo(convo.id, messages);
        totalProcessed += count;

        // Mark as read so we don't see these again
        if (count > 0) {
          await markConvoRead(convo.id);
        }
      } catch (err) {
        logger.error({ err, convoId: convo.id }, 'Failed to process DM conversation');
      }
    }

    if (totalProcessed > 0) {
      logger.info({ unreadConvos: unread.length, messagesProcessed: totalProcessed }, 'DM poll processed messages');
    }
  } catch (err) {
    logger.error({ err }, 'DM poll iteration failed');
  } finally {
    isPolling = false;
  }
}

/**
 * Start the DM polling loop. Runs alongside the firehose.
 */
export function startDmPoller(): void {
  if (!BOT_DID || !config.BSKY_BOT_PASSWORD) {
    logger.warn('BSKY_BOT_DID or BSKY_BOT_PASSWORD not set — DM polling disabled');
    return;
  }

  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'Starting DM poller');

  // First poll after a short delay (let bot agent login first)
  setTimeout(() => {
    pollOnce().catch((err) => logger.error({ err }, 'Initial DM poll failed'));
  }, 5_000);

  // Subsequent polls
  pollTimer = setInterval(() => {
    pollOnce().catch((err) => logger.error({ err }, 'DM poll failed'));
  }, POLL_INTERVAL_MS);
}

/**
 * Stop the DM polling loop.
 */
export function stopDmPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    logger.info('DM poller stopped');
  }
}

import crypto from 'crypto';
import { logger } from '../lib/logger.js';
import { logWebhookSuccess, logWebhookFailure } from '../db/queries/tracks.js';

export interface WebhookJobPayload {
  webhookId: bigint | number;
  url: string;
  secret: string;
  trackUuid: string;
  match: {
    post_uri: string;
    post_did: string;
    post_text: string;
    matched_at: string;
  };
}

export async function deliverWebhookJob(data: WebhookJobPayload): Promise<void> {
  const { webhookId, url, secret, trackUuid, match } = data;
  
  const payloadStr = JSON.stringify({
    track_uuid: trackUuid,
    match
  });

  const hmac = crypto.createHmac('sha256', secret);
  const signature = hmac.update(payloadStr).digest('hex');

  logger.info({ webhookId, url }, 'Delivering webhook');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature,
        'User-Agent': 'TrackSocial-Webhook/1.0',
      },
      body: payloadStr,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Endpoint returned HTTP ${res.status}`);
    }

    // Success - reset failures
    await logWebhookSuccess(webhookId);
    logger.info({ webhookId, url }, 'Webhook delivered successfully');
  } catch (err: any) {
    logger.error({ err: err.message, webhookId, url }, 'Webhook delivery failed');
    await logWebhookFailure(webhookId);
    throw err; // Re-throw to trigger pg-boss retry mechanism
  }
}

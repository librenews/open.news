import { postNew } from '../services/atproto.js';
import { logger } from '../lib/logger.js';

export interface BotPostJobData {
  articleTitle: string;
  articleUrl: string;
  siteName?: string | null;
}

// Simple in-memory hourly rate limiter
let postsThisHour = 0;
let hourReset = Date.now() + 3_600_000;
const MAX_POSTS_PER_HOUR = 60;

export async function botPostJob(data: BotPostJobData): Promise<void> {
  if (Date.now() > hourReset) {
    postsThisHour = 0;
    hourReset = Date.now() + 3_600_000;
  }
  if (postsThisHour >= MAX_POSTS_PER_HOUR) {
    logger.warn('Bot post rate limit reached, skipping');
    return;
  }

  const site = data.siteName ? ` — ${data.siteName}` : '';
  const text = `📰 ${data.articleTitle}${site}\n${data.articleUrl}`;

  // Trim to 300 graphemes
  const trimmed = [...text].slice(0, 295).join('');

  await postNew(trimmed);
  postsThisHour++;
  logger.info({ title: data.articleTitle }, 'Bot posted article discovery');
}

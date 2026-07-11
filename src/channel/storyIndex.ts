/**
 * Story Index Service — maintains a live index of "what's newsworthy right now"
 * by analyzing recent video transcripts grouped by category.
 *
 * Uses LLM to identify distinct story threads, with a category-level fallback
 * that ensures the channel always has content.
 */
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { llmLight } from '../services/llm.js';
import { upsertStoryQuery, deleteStoryQuery } from './opensearch.js';
import crypto from 'crypto';

export interface ActiveStory {
  id: string;
  label: string;
  keywords: string[];
  importance: number;
  category: string;
  videoCount: number;
  source: string;
}

const NEWS_CATEGORIES = ['politics', 'tech', 'finance', 'news', 'science'];

const CATEGORY_LABELS: Record<string, string> = {
  politics: 'Politics & Government',
  tech: 'Technology & AI',
  finance: 'Finance & Markets',
  news: 'Breaking News',
  science: 'Science & Nature',
};

function makeStoryId(label: string, category: string): string {
  return crypto.createHash('md5').update(`${category}:${label.toLowerCase()}`).digest('hex').slice(0, 16);
}

/**
 * Refresh the story index from recent video transcripts.
 * For each news category:
 * 1. Fetch recent transcripts (72h window)
 * 2. Use LLM to identify 2-6 distinct story threads
 * 3. Create percolator queries for matching future transcripts
 * 4. Expire stale stories
 */
export async function refreshStoryIndex(): Promise<void> {
  logger.info('Refreshing story index...');
  let totalStories = 0;

  for (const category of NEWS_CATEGORIES) {
    try {
      const { rows } = await db.query<{ id: number; text: string; media_id: number }>(
        `SELECT mt.id, mt.text, mt.media_id
         FROM media_transcripts mt
         JOIN media_items mi ON mi.id = mt.media_id
         WHERE mt.language = 'en'
           AND (mt.category = $1 OR mt.secondary_category = $1)
           AND mi.status = 'done' AND mi.error IS NULL
           AND mi.created_at > NOW() - INTERVAL '72 hours'
           AND mt.text IS NOT NULL AND mt.text != 'silent'
           AND length(mt.text) > 50
         ORDER BY mi.created_at DESC
         LIMIT 50`,
        [category]
      );

      if (rows.length < 3) {
        // Not enough content — create a single catch-all story for this category
        const fallbackId = makeStoryId(category, category);
        await db.query(
          `INSERT INTO channel_stories (id, label, keywords, importance, category, video_count, source, last_updated, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'category_fallback', NOW(), NOW() + INTERVAL '6 hours')
           ON CONFLICT (id) DO UPDATE SET
             video_count = $6, last_updated = NOW(), expires_at = NOW() + INTERVAL '6 hours'`,
          [fallbackId, CATEGORY_LABELS[category] || category, [category], 0.3, category, rows.length]
        );
        await upsertStoryQuery(fallbackId, [category]);
        totalStories++;
        continue;
      }

      // Use LLM to identify distinct stories from transcript excerpts
      const excerpts = rows.map(r => r.text.split(/\s+/).slice(0, 150).join(' ')).slice(0, 20);

      const prompt = `Analyze these video transcript excerpts from the "${category}" category. Identify 2-6 distinct news stories or topics being discussed. For each story, provide a short label (3-6 words) and 3-5 search keywords.

Transcripts:
${excerpts.map((e, i) => `[${i + 1}] ${e}`).join('\n\n')}

Respond with ONLY a JSON array:
[{"label": "Story Title", "keywords": ["keyword1", "keyword2", "keyword3"]}]`;

      let stories: { label: string; keywords: string[] }[] = [];
      try {
        const response = await llmLight.complete([
          { role: 'system', content: 'You identify distinct news stories from video transcripts. Respond with ONLY valid JSON.' },
          { role: 'user', content: prompt },
        ], { maxTokens: 500 });

        const jsonMatch = response.text.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonMatch) {
          stories = JSON.parse(jsonMatch[0]);
        }
      } catch (err) {
        logger.warn({ err, category }, 'LLM story extraction failed, using category fallback');
      }

      // Fallback: use category itself as a story
      if (stories.length === 0) {
        stories = [{ label: CATEGORY_LABELS[category] || category, keywords: [category] }];
      }

      // Upsert each story
      for (const story of stories) {
        if (!story.label || !story.keywords || story.keywords.length === 0) continue;
        const sid = makeStoryId(story.label, category);
        const importance = Math.min(1.0, 0.3 + (rows.length / 50) * 0.7);

        await db.query(
          `INSERT INTO channel_stories (id, label, keywords, importance, category, video_count, source, last_updated, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'llm_extraction', NOW(), NOW() + INTERVAL '12 hours')
           ON CONFLICT (id) DO UPDATE SET
             keywords = $3, importance = $4, video_count = $6,
             last_updated = NOW(), expires_at = NOW() + INTERVAL '12 hours'`,
          [sid, story.label, story.keywords, importance, category, rows.length]
        );

        await upsertStoryQuery(sid, story.keywords);
        totalStories++;
        logger.debug({ storyId: sid, label: story.label, keywords: story.keywords }, 'Upserted story');
      }
    } catch (err) {
      logger.error({ err, category }, 'Failed to process category for story index');
    }
  }

  // Expire old stories
  const { rows: expired } = await db.query<{ id: string }>(
    'DELETE FROM channel_stories WHERE expires_at < NOW() RETURNING id'
  );
  for (const { id } of expired) {
    await deleteStoryQuery(id);
  }

  logger.info({ totalStories, expired: expired.length }, 'Story index refresh complete');
}

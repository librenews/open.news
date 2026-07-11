/**
 * LLM-based transcript category classification for Snip.
 *
 * Classifies video transcripts into topic categories at ingest time using
 * the light LLM model (e.g. Claude Haiku). Results are stored in the DB
 * so queries can filter by category with zero runtime LLM cost.
 */
import { llmLight } from '../services/llm.js';
import { logger } from '../lib/logger.js';

export interface CategoryResult {
  category: string;
  confidence: number;
  secondary_category: string | null;
}

export const CATEGORIES = [
  { slug: 'politics', name: 'Politics', emoji: '🏛️', description: 'Government, elections, legislation, policy, political figures and debates' },
  { slug: 'tech', name: 'Tech & AI', emoji: '💻', description: 'Technology, artificial intelligence, software, hardware, coding, startups, gadgets' },
  { slug: 'finance', name: 'Finance & Business', emoji: '📈', description: 'Stock markets, economics, business news, cryptocurrency, personal finance, taxes' },
  { slug: 'science', name: 'Science & Nature', emoji: '🌿', description: 'Scientific discoveries, nature, space, climate, environment, animals, weather' },
  { slug: 'entertainment', name: 'Entertainment', emoji: '🎮', description: 'Gaming, music, movies, TV shows, anime, sports, celebrities, pop culture' },
  { slug: 'humor', name: 'Humor & Memes', emoji: '✨', description: 'Comedy, memes, funny moments, fails, jokes, viral humor' },
  { slug: 'news', name: 'Breaking News', emoji: '📰', description: 'Current events, breaking news, journalism, investigations, world events' },
  { slug: 'lifestyle', name: 'Lifestyle', emoji: '🏠', description: 'Health, fitness, food, cooking, travel, fashion, relationships, parenting, DIY' },
  { slug: 'education', name: 'Education', emoji: '📚', description: 'Tutorials, how-tos, explainers, lectures, learning content, skill development' },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]['slug'];

const VALID_SLUGS = new Set(CATEGORIES.map(c => c.slug));

const SYSTEM_PROMPT = `You are a content classifier for a short-form video platform. Given a video transcript, classify it into exactly one primary category and optionally one secondary category.

Categories:
${CATEGORIES.map(c => `- ${c.slug}: ${c.description}`).join('\n')}

Rules:
- Choose the single BEST matching primary category based on overall topic and intent of the transcript
- Only assign a secondary_category if the content genuinely spans two distinct topics (e.g., a political comedy sketch → primary "humor", secondary "politics")
- Set secondary_category to null if the content fits cleanly in one category
- confidence should reflect how clearly the content fits (0.0 to 1.0):
  - 0.9+: Clearly and entirely about this topic
  - 0.7-0.9: Mostly about this topic with minor tangents
  - 0.5-0.7: Related but not the central focus
  - <0.5: Weak or ambiguous match
- If the transcript is too short, gibberish, or does not fit any category, respond with category "uncategorized" and confidence 0
- Respond ONLY with a single JSON object, no other text

Response format: {"category":"slug","confidence":0.85,"secondary_category":"slug_or_null"}`;

/**
 * Classify a transcript into a topic category using the light LLM.
 * Designed to be called at ingest time in the media worker pipeline.
 */
export async function classifyTranscript(transcript: string): Promise<CategoryResult> {
  const DEFAULT: CategoryResult = { category: 'uncategorized', confidence: 0, secondary_category: null };

  // Skip very short, missing, or silent transcripts
  if (!transcript || transcript.trim().length < 30 || transcript.trim() === 'silent') {
    return DEFAULT;
  }

  // Truncate to ~500 words to save tokens — more than enough for classification
  const truncated = transcript.split(/\s+/).slice(0, 500).join(' ');

  try {
    const response = await llmLight.complete([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Classify this video transcript:\n\n"${truncated}"` },
    ], { maxTokens: 80 });

    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = response.text.match(/\{[^}]+\}/);
    if (!jsonMatch) {
      logger.warn({ response: response.text.slice(0, 200) }, 'LLM classification returned non-JSON');
      return DEFAULT;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate primary category
    if (!parsed.category || !VALID_SLUGS.has(parsed.category)) {
      logger.warn({ parsed }, 'LLM returned invalid category slug');
      return DEFAULT;
    }

    return {
      category: parsed.category,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0)),
      secondary_category:
        parsed.secondary_category && parsed.secondary_category !== 'null' && VALID_SLUGS.has(parsed.secondary_category)
          ? parsed.secondary_category
          : null,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to classify transcript via LLM');
    return DEFAULT;
  }
}

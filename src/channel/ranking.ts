/**
 * Ranking Engine — composite scoring for videos within stories.
 *
 * Ranking formula:
 *   score = weighted_sum(storyImportance, socialEngagement, freshness, transcriptConfidence, creatorReputation)
 *
 * Has two modes:
 * 1. Story-matched: uses video_story_matches + channel_stories tables
 * 2. Category fallback: uses snip category data directly (works from day one)
 */
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';

export interface RankedVideo {
  mediaId: number;
  uri: string;
  did: string;
  rkey: string;
  cid: string | null;
  thumbnailCid: string | null;
  storyId: string;
  storyLabel: string;
  storyCategory: string | null;
  storyImportance: number;
  score: number;
  durationMs: number | null;
  postText: string | null;
  transcript: string | null;
  likeCount: number;
  repostCount: number;
  createdAt: string;
  confidence: number;
  matchConfidence: number;
}

export interface RankingFactors {
  storyImportance: number;
  socialEngagement: number;
  freshness: number;
  transcriptConfidence: number;
  creatorReputation: number;
}

const HALF_LIFE_HOURS = 3;
const WEIGHTS = {
  storyImportance: 3.0,
  socialEngagement: 1.5,
  freshness: 2.0,
  transcriptConfidence: 0.5,
  creatorReputation: 1.0,
};

/** Compute weighted score from normalized factors. */
export function computeScore(factors: RankingFactors): number {
  const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  return (
    factors.storyImportance * WEIGHTS.storyImportance +
    factors.socialEngagement * WEIGHTS.socialEngagement +
    factors.freshness * WEIGHTS.freshness +
    factors.transcriptConfidence * WEIGHTS.transcriptConfidence +
    factors.creatorReputation * WEIGHTS.creatorReputation
  ) / totalWeight;
}

const CATEGORY_LABELS: Record<string, string> = {
  politics: 'Politics & Government',
  tech: 'Technology & AI',
  finance: 'Finance & Markets',
  news: 'Breaking News',
  science: 'Science & Nature',
};

/**
 * Get ranked videos for a channel.
 * Falls back to category-based ranking if no story matches exist yet.
 */
export async function getRankedVideosForChannel(
  channelSlug: string,
  limit = 50
): Promise<RankedVideo[]> {
  const { rows: channelRows } = await db.query<{ slug: string; category_filter: string[] | null }>(
    'SELECT slug, category_filter FROM channels WHERE slug = $1',
    [channelSlug]
  );
  if (channelRows.length === 0) return [];
  const channel = channelRows[0];

  // Check if story matches exist
  const { rows: matchCount } = await db.query<{ cnt: string }>(
    'SELECT count(*) as cnt FROM video_story_matches'
  );

  if (parseInt(matchCount[0]?.cnt || '0') > 0) {
    return await getStoryMatchedVideos(channel.category_filter, limit);
  }

  // Category fallback mode
  return await getCategoryFallbackVideos(channel.category_filter, limit);
}

/** Story-matched mode: join video_story_matches with channel_stories. */
async function getStoryMatchedVideos(
  categoryFilter: string[] | null,
  limit: number
): Promise<RankedVideo[]> {
  let categoryClause = '';
  const params: any[] = [limit];
  if (categoryFilter && categoryFilter.length > 0) {
    categoryClause = 'AND cs.category = ANY($2)';
    params.push(categoryFilter);
  }

  const { rows } = await db.query<any>(
    `SELECT mi.id as media_id, mi.uri, mi.did, mi.rkey, mi.cid, mi.thumbnail_cid,
            mi.duration_ms, mi.post_text, mi.created_at,
            mt.text as transcript, mt.confidence,
            COALESCE(ic.like_count, 0) as like_count,
            COALESCE(ic.repost_count, 0) as repost_count,
            cs.id as story_id, cs.label as story_label, cs.category as story_category,
            cs.importance as story_importance,
            vsm.confidence as match_confidence
     FROM video_story_matches vsm
     JOIN media_items mi ON mi.id = vsm.media_id
     JOIN channel_stories cs ON cs.id = vsm.story_id
     LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
     LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
     WHERE mi.status = 'done' AND mi.error IS NULL
       AND mt.language = 'en'
       AND cs.expires_at > NOW()
       ${categoryClause}
     ORDER BY cs.importance DESC, vsm.confidence DESC, mi.created_at DESC
     LIMIT $1`,
    params
  );

  return rankAndSort(rows, true);
}

/** Category fallback: rank videos by snip category + engagement.
 *  Uses LEFT JOIN so untranscribed videos can participate (scored lower
 *  via missing transcript confidence). Transcribed+categorized videos
 *  are preferred, but new videos fill in for freshness. */
async function getCategoryFallbackVideos(
  categoryFilter: string[] | null,
  limit: number
): Promise<RankedVideo[]> {
  let where = "mi.status NOT IN ('failed', 'skipped')";
  const params: any[] = [limit];

  if (categoryFilter && categoryFilter.length > 0) {
    // Include videos with matching category OR videos not yet transcribed
    where += ' AND ((mt.category = ANY($2) OR mt.secondary_category = ANY($2)) OR mt.id IS NULL)';
    params.push(categoryFilter);
  } else {
    where += " AND (mt.category IN ('politics', 'tech', 'finance', 'news', 'science') OR mt.id IS NULL)";
  }

  const { rows } = await db.query<any>(
    `SELECT mi.id as media_id, mi.uri, mi.did, mi.rkey, mi.cid, mi.thumbnail_cid,
            mi.duration_ms, mi.post_text, mi.created_at,
            COALESCE(mt.text, mi.post_text) as transcript, mt.confidence, mt.category,
            COALESCE(ic.like_count, 0) as like_count,
            COALESCE(ic.repost_count, 0) as repost_count
     FROM media_items mi
     LEFT JOIN media_transcripts mt ON mt.media_id = mi.id
     LEFT JOIN mv_media_interaction_counts ic ON ic.media_uri = mi.uri
     WHERE ${where}
       AND mi.created_at > NOW() - INTERVAL '24 hours'
       AND (mt.language = 'en' OR mt.id IS NULL)
       AND (mt.text IS NULL OR (mt.text IS NOT NULL AND mt.text != 'silent'))
     ORDER BY
       (COALESCE(ic.like_count, 0) + COALESCE(ic.repost_count, 0) * 2.0 + 1.0) /
       POWER((EXTRACT(EPOCH FROM (NOW() - mi.created_at))/3600.0) + 2.0, 1.8) DESC
     LIMIT $1`,
    params
  );

  return rankAndSort(rows, false);
}

/** Score and sort video rows. */
function rankAndSort(rows: any[], hasStoryData: boolean): RankedVideo[] {
  const maxLikes = Math.max(...rows.map((r: any) => Number(r.like_count) || 0), 1);

  return rows.map((r: any) => {
    const ageHours = (Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60);
    const freshness = Math.pow(0.5, ageHours / HALF_LIFE_HOURS);
    const engagement = maxLikes > 1
      ? Math.log(Number(r.like_count) + Number(r.repost_count) * 2 + 1) / Math.log(maxLikes + 1)
      : 0.5;
    const storyImportance = hasStoryData ? (Number(r.story_importance) || 0.5) : 0.5;

    return {
      mediaId: r.media_id,
      uri: r.uri,
      did: r.did,
      rkey: r.rkey,
      cid: r.cid,
      thumbnailCid: r.thumbnail_cid,
      storyId: hasStoryData ? r.story_id : (r.category || 'general'),
      storyLabel: hasStoryData ? r.story_label : (CATEGORY_LABELS[r.category] || 'General News'),
      storyCategory: hasStoryData ? r.story_category : r.category,
      storyImportance,
      score: computeScore({
        storyImportance,
        socialEngagement: Math.min(1, engagement),
        freshness,
        transcriptConfidence: r.confidence || 0.5,
        creatorReputation: Math.min(1, engagement),
      }),
      durationMs: r.duration_ms,
      postText: r.post_text,
      transcript: r.transcript,
      likeCount: Number(r.like_count),
      repostCount: Number(r.repost_count),
      createdAt: new Date(r.created_at).toISOString(),
      confidence: r.confidence || 0,
      matchConfidence: hasStoryData ? (Number(r.match_confidence) || 1.0) : 1.0,
    };
  }).sort((a: RankedVideo, b: RankedVideo) => b.score - a.score);
}

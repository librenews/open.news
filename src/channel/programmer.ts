/**
 * Channel Programmer — assembles ranked videos into a playable lineup.
 *
 * This is the "producer" algorithm that decides what plays next.
 * Rules:
 * - Interleave stories (max 2 consecutive from same story)
 * - Insert interstitial breaks every 5 video segments
 * - Cap at 50 segments
 * - Enrich with author profiles
 */
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { getRankedVideosForChannel, RankedVideo } from './ranking.js';
import { getCachedProfiles } from '../lib/pdsCache.js';

export interface ChannelSegment {
  type: 'video' | 'ad_break' | 'interstitial';
  mediaId?: number;
  storyId?: string;
  storyLabel?: string;
  uri?: string;
  did?: string;
  cid?: string | null;
  thumbnailCid?: string | null;
  postText?: string | null;
  transcript?: string | null;
  authorHandle?: string;
  authorDisplayName?: string;
  authorAvatar?: string | null;
  durationMs: number;
  position: number;
  likeCount?: number;
  repostCount?: number;
}

export interface ChannelLineup {
  channelSlug: string;
  channelName: string;
  generatedAt: string;
  expiresAt: string;
  segments: ChannelSegment[];
  totalDurationMs: number;
  storyCount: number;
}

const AD_BREAK_INTERVAL = 5;
const MAX_CONSECUTIVE_SAME_STORY = 2;
const AD_BREAK_DURATION_MS = 30_000;
const DEFAULT_VIDEO_DURATION_MS = 60_000;

/** Generate a channel lineup from ranked videos. */
export async function generateLineup(channelSlug: string): Promise<ChannelLineup | null> {
  const { rows: channelRows } = await db.query<{ slug: string; name: string }>(
    'SELECT slug, name FROM channels WHERE slug = $1 AND is_active = true',
    [channelSlug]
  );
  if (channelRows.length === 0) return null;
  const channel = channelRows[0];

  const rankedVideos = await getRankedVideosForChannel(channelSlug, 60);
  if (rankedVideos.length === 0) {
    logger.info({ channel: channelSlug }, 'No ranked videos available for lineup');
    return null;
  }

  const interleaved = interleaveByStory(rankedVideos);

  // Enrich with author profiles
  const uniqueDids = [...new Set(interleaved.map(v => v.did))];
  const profileMap = await getCachedProfiles(uniqueDids);

  // Build segments
  const segments: ChannelSegment[] = [];
  let videoCount = 0;
  const storyIds = new Set<string>();

  for (const video of interleaved) {
    if (videoCount > 0 && videoCount % AD_BREAK_INTERVAL === 0) {
      segments.push({
        type: 'interstitial',
        durationMs: AD_BREAK_DURATION_MS,
        position: segments.length,
        storyLabel: interleaved[videoCount]?.storyLabel || 'More News',
      });
    }

    const profile = profileMap.get(video.did);
    segments.push({
      type: 'video',
      mediaId: video.mediaId,
      storyId: video.storyId,
      storyLabel: video.storyLabel,
      uri: video.uri,
      did: video.did,
      cid: video.cid,
      thumbnailCid: video.thumbnailCid,
      postText: video.postText,
      transcript: video.transcript,
      authorHandle: profile?.handle || video.did,
      authorDisplayName: profile?.displayName || profile?.handle || video.did,
      authorAvatar: profile?.avatar || null,
      durationMs: video.durationMs || DEFAULT_VIDEO_DURATION_MS,
      position: segments.length,
      likeCount: video.likeCount,
      repostCount: video.repostCount,
    });

    storyIds.add(video.storyId);
    videoCount++;
  }

  const totalDurationMs = segments.reduce((sum, s) => sum + s.durationMs, 0);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  // Record video history (fire-and-forget, non-blocking)
  recordNewsQualifications(rankedVideos).catch(err =>
    logger.warn({ err }, 'Failed to record news qualifications (non-fatal)'));
  updatePlaylistPositions(channel.slug, segments).catch(err =>
    logger.warn({ err }, 'Failed to update playlist positions (non-fatal)'));

  return {
    channelSlug: channel.slug,
    channelName: channel.name,
    generatedAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    segments,
    totalDurationMs,
    storyCount: storyIds.size,
  };
}

/** Interleave videos so same story doesn't repeat too many times. */
function interleaveByStory(videos: RankedVideo[]): RankedVideo[] {
  const result: RankedVideo[] = [];
  const remaining = [...videos];
  let lastStoryId = '';
  let consecutiveCount = 0;

  while (remaining.length > 0) {
    let idx = 0;
    if (consecutiveCount >= MAX_CONSECUTIVE_SAME_STORY) {
      idx = remaining.findIndex(v => v.storyId !== lastStoryId);
      if (idx === -1) idx = 0;
    }

    const video = remaining.splice(idx, 1)[0];
    if (video.storyId === lastStoryId) {
      consecutiveCount++;
    } else {
      consecutiveCount = 1;
      lastStoryId = video.storyId;
    }
    result.push(video);
  }

  return result;
}

// ── Video History Tracking ────────────────────────────────────────────────────

const NEWS_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Record news qualifications for videos that matched stories.
 * Only records videos with match confidence above threshold.
 * Uses ON CONFLICT to avoid duplicates — first qualification wins.
 */
async function recordNewsQualifications(rankedVideos: RankedVideo[]): Promise<void> {
  const qualified = rankedVideos.filter(
    v => v.matchConfidence >= NEWS_CONFIDENCE_THRESHOLD && v.storyId && v.storyLabel
  );
  if (qualified.length === 0) return;

  for (const video of qualified) {
    await db.query(
      `INSERT INTO video_news_history
         (media_id, media_uri, story_id, story_label, story_category,
          story_importance, match_confidence, composite_score, qualified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (media_id, story_id) DO NOTHING`,
      [
        video.mediaId, video.uri, video.storyId, video.storyLabel,
        video.storyCategory, video.storyImportance,
        video.matchConfidence, video.score,
      ]
    );
  }

  logger.info({ count: qualified.length }, 'Recorded news qualifications');
}

/**
 * Update playlist position history after a lineup is generated.
 *
 * For each video in the new lineup:
 *   - New video: INSERT with peak_position
 *   - Existing, improved position: UPDATE peak_position and peak_at
 *   - Existing, same or worse position: UPDATE current_position and last_appeared_at
 *   - Returning after bump: clear bumped_at, increment return_count
 *
 * For videos previously on the playlist but not in the new one:
 *   - Set bumped_at = NOW(), current_position = NULL
 */
async function updatePlaylistPositions(
  channelSlug: string,
  segments: ChannelSegment[]
): Promise<void> {
  // Build video-only position map (1-indexed)
  const videoSegments = segments.filter(s => s.type === 'video' && s.mediaId);
  const positionMap = new Map<number, { position: number; uri: string }>();
  videoSegments.forEach((seg, idx) => {
    if (seg.mediaId) {
      positionMap.set(seg.mediaId, { position: idx + 1, uri: seg.uri || '' });
    }
  });

  if (positionMap.size === 0) return;

  // Fetch current state for this channel
  const { rows: existing } = await db.query<{
    media_id: number;
    peak_position: number;
    bumped_at: Date | null;
  }>(
    'SELECT media_id, peak_position, bumped_at FROM video_playlist_history WHERE channel_slug = $1',
    [channelSlug]
  );
  const existingMap = new Map(existing.map(r => [r.media_id, r]));

  const now = new Date().toISOString();

  // Upsert videos currently on the playlist
  for (const [mediaId, { position, uri }] of positionMap) {
    const prev = existingMap.get(mediaId);

    if (!prev) {
      // New video — first appearance
      await db.query(
        `INSERT INTO video_playlist_history
           (media_id, media_uri, channel_slug, peak_position, peak_at,
            current_position, first_appeared_at, last_appeared_at,
            bumped_at, appearance_count, return_count)
         VALUES ($1, $2, $3, $4, $5, $4, $5, $5, NULL, 1, 0)
         ON CONFLICT (media_id, channel_slug) DO UPDATE SET
            current_position = $4,
            last_appeared_at = $5,
            appearance_count = video_playlist_history.appearance_count + 1,
            bumped_at = NULL`,
        [mediaId, uri, channelSlug, position, now]
      );
    } else if (prev.bumped_at) {
      // Returning after being bumped
      const newPeak = position < prev.peak_position ? position : prev.peak_position;
      const peakAt = position < prev.peak_position ? now : undefined;
      await db.query(
        `UPDATE video_playlist_history SET
            current_position = $1,
            last_appeared_at = $2,
            bumped_at = NULL,
            return_count = return_count + 1,
            appearance_count = appearance_count + 1,
            peak_position = LEAST(peak_position, $1),
            peak_at = CASE WHEN $1 < peak_position THEN $2::timestamptz ELSE peak_at END
         WHERE media_id = $3 AND channel_slug = $4`,
        [position, now, mediaId, channelSlug]
      );
      if (peakAt) {
        logger.info({ mediaId, channelSlug, position }, 'Video returned to playlist with new peak');
      }
    } else if (position < prev.peak_position) {
      // Still on playlist, improved position (new peak)
      await db.query(
        `UPDATE video_playlist_history SET
            current_position = $1,
            peak_position = $1,
            peak_at = $2,
            last_appeared_at = $2,
            appearance_count = appearance_count + 1
         WHERE media_id = $3 AND channel_slug = $4`,
        [position, now, mediaId, channelSlug]
      );
    } else {
      // Still on playlist, same or worse position
      await db.query(
        `UPDATE video_playlist_history SET
            current_position = $1,
            last_appeared_at = $2,
            appearance_count = appearance_count + 1
         WHERE media_id = $3 AND channel_slug = $4`,
        [position, now, mediaId, channelSlug]
      );
    }
  }

  // Mark videos no longer on the playlist as bumped
  const currentMediaIds = [...positionMap.keys()];
  if (existing.length > 0) {
    const stillActive = existing.filter(r => !r.bumped_at && !positionMap.has(r.media_id));
    for (const row of stillActive) {
      await db.query(
        `UPDATE video_playlist_history SET
            bumped_at = $1,
            current_position = NULL
         WHERE media_id = $2 AND channel_slug = $3`,
        [now, row.media_id, channelSlug]
      );
    }
    if (stillActive.length > 0) {
      logger.info({ count: stillActive.length, channelSlug }, 'Videos bumped from playlist');
    }
  }
}

/** Persist a lineup to the database and cache in Redis. */
export async function persistLineup(lineup: ChannelLineup): Promise<void> {
  try {
    await db.query(
      `INSERT INTO channel_lineups (channel_slug, segments, total_duration_ms, generated_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [lineup.channelSlug, JSON.stringify(lineup.segments), lineup.totalDurationMs,
       lineup.generatedAt, lineup.expiresAt]
    );
  } catch (err) {
    logger.error({ err }, 'Failed to persist lineup to DB');
  }

  try {
    const { getRedis } = await import('../lib/redis.js');
    const redis = getRedis();
    await redis.set(
      `channel:lineup:${lineup.channelSlug}`,
      JSON.stringify(lineup),
      'EX', 1800
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to cache lineup in Redis (non-fatal)');
  }
}

/** Get the current lineup for a channel (Redis cache -> DB fallback). */
export async function getCurrentLineup(channelSlug: string): Promise<ChannelLineup | null> {
  try {
    const { getRedis } = await import('../lib/redis.js');
    const redis = getRedis();
    const cached = await redis.get(`channel:lineup:${channelSlug}`);
    if (cached) return JSON.parse(cached) as ChannelLineup;
  } catch { /* fall through */ }

  try {
    const { rows } = await db.query<{ segments: any; total_duration_ms: number; generated_at: Date; expires_at: Date }>(
      `SELECT segments, total_duration_ms, generated_at, expires_at
       FROM channel_lineups
       WHERE channel_slug = $1 AND expires_at > NOW()
       ORDER BY generated_at DESC
       LIMIT 1`,
      [channelSlug]
    );
    if (rows.length === 0) return null;

    const { rows: chRows } = await db.query<{ name: string }>(
      'SELECT name FROM channels WHERE slug = $1', [channelSlug]
    );

    const segments = rows[0].segments as ChannelSegment[];
    return {
      channelSlug,
      channelName: chRows[0]?.name || channelSlug,
      generatedAt: rows[0].generated_at.toISOString(),
      expiresAt: rows[0].expires_at.toISOString(),
      segments,
      totalDurationMs: rows[0].total_duration_ms,
      storyCount: new Set(segments.filter(s => s.storyId).map(s => s.storyId)).size,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to get lineup from DB');
    return null;
  }
}

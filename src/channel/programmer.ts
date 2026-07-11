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

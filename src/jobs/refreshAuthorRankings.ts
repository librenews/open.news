import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';

/**
 * Author Influence Score (AIS) — a composite ranking that rewards:
 *   - Recent engagement velocity (time-decayed likes/shares)
 *   - Content momentum (sustained publishing cadence)
 *   - Quality signal (median engagement per article — resistant to outliers)
 *   - Consistency (regular publishing intervals)
 *   - Network influence (follower gravity with ratio cap)
 *   - Freshness decay (multiplicative — dormant authors drop fast)
 *
 * Only verified authors (with at least one verified article) are ranked.
 */

interface AuthorRaw {
  author_did: string;
  articles: {
    uri: string;
    published_at: Date;
    like_count: number;
    share_count: number;
    repost_count: number;
  }[];
  follower_count: number;
  following_count: number;
}

// ── Signal Computations ──────────────────────────────────────────────────────

/**
 * Signal 1: Engagement Velocity (time-decayed interactions)
 * Σ (likes + shares×2 + reposts×3) × e^(-age_days / 30)
 */
function engagementVelocity(articles: AuthorRaw['articles']): number {
  const now = Date.now();
  let score = 0;
  for (const a of articles) {
    const ageDays = (now - a.published_at.getTime()) / 86_400_000;
    const engagement = a.like_count + a.share_count * 2 + a.repost_count * 3;
    score += engagement * Math.exp(-ageDays / 30);
  }
  return score;
}

/**
 * Signal 2: Content Momentum — sustained publishing cadence
 * ln(1 + articles_30d) × ln(1 + articles_90d)
 * Log-scaled to prevent quantity spam from dominating.
 */
function contentMomentum(articles: AuthorRaw['articles']): number {
  const now = Date.now();
  let count30 = 0, count90 = 0;
  for (const a of articles) {
    const ageDays = (now - a.published_at.getTime()) / 86_400_000;
    if (ageDays <= 30) count30++;
    if (ageDays <= 90) count90++;
  }
  return Math.log(1 + count30) * Math.log(1 + count90);
}

/**
 * Signal 3: Quality Signal — MEDIAN engagement per article (last 90 days)
 * Median is far more resistant to gaming than mean — one viral article
 * doesn't inflate the score, you need consistently good content.
 */
function qualitySignal(articles: AuthorRaw['articles']): number {
  const now = Date.now();
  const recentEngagements = articles
    .filter(a => (now - a.published_at.getTime()) / 86_400_000 <= 90)
    .map(a => a.like_count + a.share_count * 2 + a.repost_count * 3)
    .sort((a, b) => a - b);

  if (recentEngagements.length === 0) return 0;
  const mid = Math.floor(recentEngagements.length / 2);
  return recentEngagements.length % 2 === 0
    ? (recentEngagements[mid - 1] + recentEngagements[mid]) / 2
    : recentEngagements[mid];
}

/**
 * Signal 4: Consistency — inverse of publication interval variance
 * 1 / (1 + σ(days_between_posts))
 * Regular weekly publishers beat erratic burst-and-disappear patterns.
 */
function consistencyScore(articles: AuthorRaw['articles']): number {
  if (articles.length < 2) return 0;

  // Sort by date
  const dates = articles
    .map(a => a.published_at.getTime())
    .sort((a, b) => a - b);

  // Compute intervals in days
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    intervals.push((dates[i] - dates[i - 1]) / 86_400_000);
  }

  // Standard deviation
  const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length;
  const stddev = Math.sqrt(variance);

  return 1 / (1 + stddev);
}

/**
 * Signal 5: Network Influence — follower gravity with ratio cap
 * ln(1 + followers) × min(followers / max(following, 1), 5)
 * The ratio cap prevents follow-for-follow gaming.
 */
function networkInfluence(followerCount: number, followingCount: number): number {
  const ratio = Math.min(followerCount / Math.max(followingCount, 1), 5);
  return Math.log(1 + followerCount) * ratio;
}

/**
 * Signal 6: Freshness Decay — multiplicative penalty for dormancy
 * e^(-days_since_last_post / 45)
 * Halves every ~31 days. 60 days dormant → ~26% of original score.
 */
function freshnessDecay(articles: AuthorRaw['articles']): number {
  if (articles.length === 0) return 0;
  const now = Date.now();
  const lastPublished = Math.max(...articles.map(a => a.published_at.getTime()));
  const daysSince = (now - lastPublished) / 86_400_000;
  return Math.exp(-daysSince / 45);
}

// ── Main Job ─────────────────────────────────────────────────────────────────

export async function refreshAuthorRankings(): Promise<void> {
  const start = Date.now();
  logger.info('Starting author rankings refresh');

  // Step 1: Get all verified authors with articles in the last 180 days
  const { rows: articleRows } = await db.query(`
    SELECT
      s.author_did,
      s.uri,
      s.published_at,
      COUNT(CASE WHEN ai.interaction_type = 'like' THEN 1 END)::int AS like_count,
      COUNT(CASE WHEN ai.interaction_type = 'share' THEN 1 END)::int AS share_count,
      COUNT(CASE WHEN ai.interaction_type = 'repost' THEN 1 END)::int AS repost_count
    FROM site_standard_articles s
    LEFT JOIN article_interactions ai ON ai.article_uri = s.uri
    WHERE s.verified = true
      AND s.published_at > NOW() - INTERVAL '180 days'
    GROUP BY s.author_did, s.uri, s.published_at
  `);

  // Group by author
  const authorMap = new Map<string, AuthorRaw['articles']>();
  for (const row of articleRows) {
    if (!authorMap.has(row.author_did)) authorMap.set(row.author_did, []);
    authorMap.get(row.author_did)!.push({
      uri: row.uri,
      published_at: new Date(row.published_at),
      like_count: Number(row.like_count),
      share_count: Number(row.share_count),
      repost_count: Number(row.repost_count),
    });
  }

  const authorDids = [...authorMap.keys()];
  if (authorDids.length === 0) {
    logger.info('No verified authors found, skipping');
    return;
  }

  // Step 2: Fetch follower/following counts
  const { rows: followerRows } = await db.query(`
    SELECT following_did AS did, COUNT(*)::int AS cnt
    FROM blogs_follows
    WHERE following_did = ANY($1)
    GROUP BY following_did
  `, [authorDids]);
  const followerMap = new Map(followerRows.map((r: any) => [r.did, Number(r.cnt)]));

  const { rows: followingRows } = await db.query(`
    SELECT follower_did AS did, COUNT(*)::int AS cnt
    FROM blogs_follows
    WHERE follower_did = ANY($1)
    GROUP BY follower_did
  `, [authorDids]);
  const followingMap = new Map(followingRows.map((r: any) => [r.did, Number(r.cnt)]));

  // Step 3: Compute scores
  const scores: Array<{
    did: string;
    ais: number;
    ev: number;
    cm: number;
    qs: number;
    cs: number;
    ni: number;
    fd: number;
    count90: number;
    likes: number;
    shares: number;
    followers: number;
    lastPub: Date | null;
  }> = [];

  for (const [did, articles] of authorMap) {
    const followers = followerMap.get(did) ?? 0;
    const following = followingMap.get(did) ?? 0;

    const ev = engagementVelocity(articles);
    const cm = contentMomentum(articles);
    const qs = qualitySignal(articles);
    const cs = consistencyScore(articles);
    const ni = networkInfluence(followers, following);
    const fd = freshnessDecay(articles);

    // Composite score — weighted sum × freshness multiplier
    const raw = ev * 0.30 + cm * 0.25 + qs * 0.20 + cs * 0.15 + ni * 0.10;
    const ais = raw * fd;

    const now = Date.now();
    const count90 = articles.filter(a => (now - a.published_at.getTime()) / 86_400_000 <= 90).length;
    const likes = articles.reduce((s, a) => s + a.like_count, 0);
    const shares = articles.reduce((s, a) => s + a.share_count + a.repost_count, 0);
    const lastPub = articles.length > 0
      ? new Date(Math.max(...articles.map(a => a.published_at.getTime())))
      : null;

    scores.push({ did, ais, ev, cm, qs, cs, ni, fd, count90, likes, shares, followers, lastPub });
  }

  // Sort and assign rank
  scores.sort((a, b) => b.ais - a.ais);

  // Step 4: Upsert into author_rankings
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Clear old rankings
    await client.query('DELETE FROM author_rankings');

    for (let i = 0; i < scores.length; i++) {
      const s = scores[i];
      await client.query(`
        INSERT INTO author_rankings (
          author_did, ais, engagement_vel, content_momentum, quality_signal,
          consistency, network_score, freshness_decay, rank,
          article_count_90d, total_likes, total_shares, follower_count,
          last_published, computed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
      `, [
        s.did, s.ais, s.ev, s.cm, s.qs, s.cs, s.ni, s.fd,
        i + 1, s.count90, s.likes, s.shares, s.followers, s.lastPub,
      ]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  logger.info({ authorCount: scores.length, topScore: scores[0]?.ais.toFixed(3), elapsed }, 'Author rankings refreshed');
}

// Direct execution
refreshAuthorRankings()
  .then(() => { logger.info('Done'); process.exit(0); })
  .catch((err) => { logger.error(err, 'Failed'); process.exit(1); });

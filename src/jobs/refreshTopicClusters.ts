import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { embedTexts } from '../track/embedClient.js';
import { llmLight } from '../services/llm.js';

interface TrackForClustering {
  id: number;
  keywords: string[];
  query: string | null;
}

interface Cluster {
  trackIds: number[];
  keywords: string[];
  centroid: number[];
}

const SIMILARITY_THRESHOLD = 0.75;

/**
 * Compute cosine similarity between two vectors.
 */
function cosineSim(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Compute the centroid (average) of an array of vectors.
 */
function centroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const avg = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) avg[i] += v[i];
  }
  for (let i = 0; i < dim; i++) avg[i] /= vectors.length;
  return avg;
}

/**
 * Build the text to embed for a track — combines keywords + semantic query.
 */
function trackToEmbedText(t: TrackForClustering): string {
  const parts: string[] = [];
  if (t.keywords.length > 0) parts.push(t.keywords.join(', '));
  if (t.query) parts.push(t.query);
  return parts.join(' — ') || 'general';
}

/**
 * Ask LLM to generate a clean, short topic label from a set of keywords.
 */
async function generateTopicLabel(keywords: string[]): Promise<string> {
  const deduped = [...new Set(keywords)].slice(0, 20);
  try {
    const response = await llmLight.complete([
      {
        role: 'system',
        content: 'You generate short, clean topic labels for news sections. Respond with ONLY the label, 2-4 words, title case. No quotes, no punctuation, no explanation.',
      },
      {
        role: 'user',
        content: `Generate a topic label for news articles matching these terms: ${deduped.join(', ')}`,
      },
    ], { maxTokens: 20 });
    return response.text.trim().replace(/^["']|["']$/g, '');
  } catch (err) {
    logger.error({ err, keywords }, 'Failed to generate topic label');
    // Fallback: use first keyword, title-cased
    return deduped[0]?.replace(/\b\w/g, c => c.toUpperCase()) || 'General';
  }
}

/**
 * Main clustering job: fetches active tracks, embeds their keywords/queries,
 * clusters by cosine similarity, generates labels, and persists to topic_clusters.
 */
export async function refreshTopicClusters(): Promise<void> {
  logger.info('Starting topic cluster refresh');

  // 1. Fetch tracks that had matches in the last 48 hours
  const { rows: tracks } = await db.query<TrackForClustering>(
    `SELECT DISTINCT t.id, t.keywords, t.query
     FROM tracks t
     JOIN track_matches tm ON t.id = tm.track_id
     WHERE t.is_active = true
       AND tm.matched_at > NOW() - INTERVAL '48 hours'`
  );

  if (tracks.length === 0) {
    logger.info('No active tracks with recent matches, skipping clustering');
    return;
  }

  logger.info({ trackCount: tracks.length }, 'Fetched tracks for clustering');

  // 2. Build embedding texts and embed them
  const embedTextsArr = tracks.map(trackToEmbedText);
  const { embeddings } = await embedTexts(embedTextsArr);

  // 3. Agglomerative clustering by cosine similarity
  const clusters: Cluster[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < tracks.length; i++) {
    if (assigned.has(i)) continue;

    // Start a new cluster with this track
    const cluster: Cluster = {
      trackIds: [tracks[i].id],
      keywords: [...tracks[i].keywords, ...(tracks[i].query ? [tracks[i].query!] : [])],
      centroid: embeddings[i],
    };
    assigned.add(i);

    // Find all unassigned tracks similar to this cluster's centroid
    const clusterVectors = [embeddings[i]];
    for (let j = i + 1; j < tracks.length; j++) {
      if (assigned.has(j)) continue;
      const sim = cosineSim(cluster.centroid, embeddings[j]);
      if (sim >= SIMILARITY_THRESHOLD) {
        cluster.trackIds.push(tracks[j].id);
        cluster.keywords.push(...tracks[j].keywords);
        if (tracks[j].query) cluster.keywords.push(tracks[j].query!);
        clusterVectors.push(embeddings[j]);
        cluster.centroid = centroid(clusterVectors);
        assigned.add(j);
      }
    }

    clusters.push(cluster);
  }

  logger.info({ clusterCount: clusters.length }, 'Formed clusters');

  // 4. For each cluster, count articles and generate label
  await db.query('DELETE FROM topic_clusters');

  for (const cluster of clusters) {
    // Count articles matched by this cluster's tracks in last 48h
    const { rows: [countRow] } = await db.query(
      `SELECT COUNT(DISTINCT a.id) AS cnt
       FROM articles a
       JOIN article_sources asrc ON a.id = asrc.article_id
       JOIN track_matches tm ON asrc.post_uri = tm.post_uri
       WHERE tm.track_id = ANY($1)
         AND a.is_news = true
         AND tm.matched_at > NOW() - INTERVAL '48 hours'`,
      [cluster.trackIds]
    );
    const articleCount = Number(countRow?.cnt || 0);

    // Generate AI label
    const uniqueKeywords = [...new Set(cluster.keywords)];
    const label = await generateTopicLabel(uniqueKeywords);

    await db.query(
      `INSERT INTO topic_clusters (label, track_ids, keywords, centroid, article_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [label, cluster.trackIds, uniqueKeywords.slice(0, 30), cluster.centroid, articleCount]
    );

    logger.info({ label, tracks: cluster.trackIds.length, articles: articleCount }, 'Created topic cluster');
  }

  logger.info('Topic cluster refresh complete');
}

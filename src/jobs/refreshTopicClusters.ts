import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { getOsClient, SITE_STANDARD_CHUNKS_INDEX } from '../track/opensearch.js';
import { llmLight } from '../services/llm.js';

interface ArticleForClustering {
  uri: string;
  title: string;
  site: string | null;
}

interface Cluster {
  articleUris: string[];
  titles: string[];
  centroid: number[];
}

const SIMILARITY_THRESHOLD = 0.58;
const MAX_ARTICLES_TO_CLUSTER = 300;
const EMBED_BATCH_SIZE = 50;

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
 * Ask LLM to generate a clean, short topic label from article titles.
 */
async function generateTopicLabel(titles: string[]): Promise<string> {
  const deduped = [...new Set(titles)].slice(0, 15);
  try {
    const response = await llmLight.complete([
      {
        role: 'system',
        content: 'You generate short, clean topic labels for news sections. Respond with ONLY the label, 2-4 words, title case. No quotes, no punctuation, no explanation.',
      },
      {
        role: 'user',
        content: `Generate a topic label that captures the shared theme of these article titles:\n${deduped.map(t => `- ${t}`).join('\n')}`,
      },
    ], { maxTokens: 20 });
    return response.text.trim().replace(/^["']|["']$/g, '');
  } catch (err) {
    logger.error({ err }, 'Failed to generate topic label');
    // Fallback: extract most common words from titles
    const words = deduped.join(' ').split(/\s+/).filter(w => w.length > 3);
    return words[0]?.replace(/\b\w/g, c => c.toUpperCase()) || 'General';
  }
}

/**
 * Fetch the first chunk embedding for an article from OpenSearch.
 * Returns null if no embedding exists.
 */
async function getArticleEmbedding(os: any, uri: string): Promise<number[] | null> {
  try {
    const res = await os.search({
      index: SITE_STANDARD_CHUNKS_INDEX,
      body: {
        size: 1,
        query: { term: { uri } },
        sort: [{ chunk_index: 'asc' }],
        _source: ['embedding'],
      },
    });
    return res.body.hits?.hits?.[0]?._source?.embedding ?? null;
  } catch {
    return null;
  }
}

/**
 * Main clustering job: fetches recent verified articles, retrieves their
 * existing embeddings from the site_standard_chunks index, clusters by
 * cosine similarity, generates AI labels, and persists to topic_clusters.
 */
export async function refreshTopicClusters(): Promise<void> {
  logger.info('Starting topic cluster refresh (site_standard mode)');

  // 1. Fetch recent verified articles (last 7 days, most interacted first)
  const { rows: articles } = await db.query<ArticleForClustering>(
    `SELECT a.uri, a.title, a.site
     FROM site_standard_articles a
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS cnt FROM article_interactions
       WHERE article_uri = a.uri
     ) ic ON true
     WHERE a.verified = true
       AND a.suppressed IS NOT TRUE
       AND a.title IS NOT NULL
       AND a.published_at > NOW() - INTERVAL '30 days'
     ORDER BY COALESCE(ic.cnt, 0) DESC, a.published_at DESC
     LIMIT $1`,
    [MAX_ARTICLES_TO_CLUSTER]
  );

  if (articles.length === 0) {
    logger.info('No recent verified articles, skipping clustering');
    return;
  }

  logger.info({ articleCount: articles.length }, 'Fetched articles for clustering');

  // 2. Retrieve existing embeddings from OpenSearch (in batches)
  const os = getOsClient();
  const embeddings: (number[] | null)[] = [];

  for (let i = 0; i < articles.length; i += EMBED_BATCH_SIZE) {
    const batch = articles.slice(i, i + EMBED_BATCH_SIZE);
    const batchEmbeddings = await Promise.all(
      batch.map(a => getArticleEmbedding(os, a.uri))
    );
    embeddings.push(...batchEmbeddings);
  }

  // Filter to only articles that have embeddings
  const indexed: { article: ArticleForClustering; embedding: number[] }[] = [];
  for (let i = 0; i < articles.length; i++) {
    if (embeddings[i]) {
      indexed.push({ article: articles[i], embedding: embeddings[i]! });
    }
  }

  if (indexed.length < 3) {
    logger.info({ withEmbeddings: indexed.length }, 'Too few articles with embeddings, skipping');
    return;
  }

  logger.info({ withEmbeddings: indexed.length, total: articles.length }, 'Articles with embeddings ready');

  // 3. Agglomerative clustering by cosine similarity
  const clusters: Cluster[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < indexed.length; i++) {
    if (assigned.has(i)) continue;

    const cluster: Cluster = {
      articleUris: [indexed[i].article.uri],
      titles: indexed[i].article.title ? [indexed[i].article.title] : [],
      centroid: indexed[i].embedding,
    };
    assigned.add(i);

    const clusterVectors = [indexed[i].embedding];
    for (let j = i + 1; j < indexed.length; j++) {
      if (assigned.has(j)) continue;
      const sim = cosineSim(cluster.centroid, indexed[j].embedding);
      if (sim >= SIMILARITY_THRESHOLD) {
        cluster.articleUris.push(indexed[j].article.uri);
        if (indexed[j].article.title) cluster.titles.push(indexed[j].article.title);
        clusterVectors.push(indexed[j].embedding);
        cluster.centroid = centroid(clusterVectors);
        assigned.add(j);
      }
    }

    clusters.push(cluster);
  }

  // Sort clusters: multi-article clusters first, then by size
  clusters.sort((a, b) => b.articleUris.length - a.articleUris.length);

  // Keep clusters with 2+ articles; if very few, also include singletons
  const multiArticle = clusters.filter(c => c.articleUris.length >= 2);
  const minSize = multiArticle.length >= 5 ? 2 : 1;
  const finalClusters = clusters
    .filter(c => c.articleUris.length >= minSize)
    .slice(0, 30);

  logger.info({
    totalClusters: clusters.length,
    meaningful: finalClusters.length,
    singletons: clusters.length - multiArticle.length,
  }, 'Formed clusters');

  // 4. Generate labels and persist
  await db.query('DELETE FROM topic_clusters');

  for (const cluster of finalClusters) {
    const label = await generateTopicLabel(cluster.titles);
    const articleCount = cluster.articleUris.length;

    await db.query(
      `INSERT INTO topic_clusters (label, track_ids, keywords, centroid, article_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        label,
        [], // no track_ids in the new model
        cluster.titles.slice(0, 20),
        cluster.centroid,
        articleCount,
      ]
    );

    logger.info({ label, articles: articleCount }, 'Created topic cluster');
  }

  logger.info({ clusters: finalClusters.length }, 'Topic cluster refresh complete');
}

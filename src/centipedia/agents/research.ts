/**
 * Centipedia Research Agent
 * 
 * Polls for pending citations, validates them, extracts content,
 * then groups accepted citations by topic and synthesizes articles.
 *
 * Lifecycle:
 *   1. Pick up pending citations
 *   2. Fetch URL → extract title + main text
 *   3. Mark as accepted/rejected
 *   4. When a topic reaches threshold, trigger synthesis
 *   5. Publish article under bot DID
 *   6. Announce on Bluesky
 */

import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { llm } from '../../services/llm.js';
import type { LLMMessage } from '../../services/llm.js';
import { getCentipediaBot, announceArticle } from '../bot.js';
import { config } from '../../lib/config.js';

const POLL_INTERVAL_MS = 30_000;
const MIN_CITATIONS_FOR_ARTICLE = 2;
const MAX_CONTENT_LENGTH = 8000; // chars per citation content extraction

// ─── Content extraction ──────────────────────────────────────────────────────

/**
 * Fetch a URL, extract main text content.
 * Returns { title, text, domain } or null on failure.
 */
async function extractContent(url: string): Promise<{ title: string; text: string; domain: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Centipedia/1.0 (research-agent)' },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return null;

    const domain = new URL(url).hostname.replace(/^www\./, '');
    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim() || url;

    // Extract main text — strip tags, scripts, styles
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();

    // Trim to max length
    if (text.length > MAX_CONTENT_LENGTH) {
      text = text.substring(0, MAX_CONTENT_LENGTH) + '…';
    }

    return { title, text, domain };
  } catch (err: any) {
    if (err.name === 'AbortError') return null;
    logger.warn({ err, url }, 'Content extraction failed');
    return null;
  }
}

// ─── Citation processing ─────────────────────────────────────────────────────

async function processPendingCitations(): Promise<number> {
  const { rows: pending } = await db.query(
    `SELECT id, url, title, topic, excerpt FROM centipedia_citations
     WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10`
  );

  if (pending.length === 0) return 0;
  logger.info({ count: pending.length }, 'Processing pending citations');

  let accepted = 0;
  for (const cit of pending) {
    const content = await extractContent(cit.url);

    if (!content || content.text.length < 50) {
      // Reject — URL is inaccessible or has no meaningful content
      await db.query(
        "UPDATE centipedia_citations SET status = 'rejected' WHERE id = $1",
        [cit.id]
      );
      logger.info({ id: cit.id, url: cit.url }, 'Citation rejected (inaccessible or no content)');
      continue;
    }

    // Update title if not set
    if (!cit.title) {
      await db.query(
        'UPDATE centipedia_citations SET title = $1 WHERE id = $2',
        [content.title, cit.id]
      );
    }

    // If no topic, infer one from the content
    let topic = cit.topic;
    if (!topic) {
      topic = await inferTopic(content.title, content.text);
      await db.query(
        'UPDATE centipedia_citations SET topic = $1 WHERE id = $2',
        [topic, cit.id]
      );
    }

    // Store extracted content as excerpt if not provided
    if (!cit.excerpt) {
      const excerpt = content.text.substring(0, 300).trim();
      await db.query(
        'UPDATE centipedia_citations SET excerpt = $1 WHERE id = $2',
        [excerpt, cit.id]
      );
    }

    // Mark accepted
    await db.query(
      "UPDATE centipedia_citations SET status = 'accepted' WHERE id = $1",
      [cit.id]
    );
    accepted++;
    logger.info({ id: cit.id, url: cit.url, topic }, 'Citation accepted');
  }

  return accepted;
}

async function inferTopic(title: string, text: string): Promise<string> {
  try {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: 'You are a topic classifier. Given a document title and excerpt, respond with a single short topic label (2-4 words max). Be specific but not overly narrow. Examples: "Climate Change", "AT Protocol", "Machine Learning", "Space Exploration". Respond with ONLY the topic, nothing else.'
      },
      {
        role: 'user',
        content: `Title: ${title}\n\nExcerpt: ${text.substring(0, 500)}`
      }
    ];
    const result = await llm.complete(messages, { maxTokens: 20 });
    return result.text.trim().replace(/['"]/g, '').substring(0, 100);
  } catch (err: any) {
    logger.warn({ err }, 'Topic inference failed, using default');
    return 'General';
  }
}

// ─── Article synthesis ───────────────────────────────────────────────────────

async function checkAndSynthesizeArticles(): Promise<number> {
  // Find topics with enough accepted citations that don't have an article yet
  const { rows: readyTopics } = await db.query(
    `SELECT topic, count(*) AS cnt
     FROM centipedia_citations
     WHERE status = 'accepted' AND article_rkey IS NULL AND topic IS NOT NULL
     GROUP BY topic
     HAVING count(*) >= $1
     ORDER BY cnt DESC LIMIT 5`,
    [MIN_CITATIONS_FOR_ARTICLE]
  );

  let articlesCreated = 0;
  for (const { topic, cnt } of readyTopics) {
    logger.info({ topic, citations: cnt }, 'Synthesizing article');
    try {
      await synthesizeArticle(topic);
      articlesCreated++;
    } catch (err: any) {
      logger.error({ err, topic }, 'Article synthesis failed');
    }
  }

  return articlesCreated;
}

async function synthesizeArticle(topic: string): Promise<void> {
  // Gather all accepted citations for this topic
  const { rows: citations } = await db.query(
    `SELECT id, url, title, excerpt FROM centipedia_citations
     WHERE status = 'accepted' AND article_rkey IS NULL AND topic = $1
     ORDER BY created_at ASC`,
    [topic]
  );

  if (citations.length < MIN_CITATIONS_FOR_ARTICLE) return;

  // Build source context for the LLM
  const sourcesText = citations.map((c: any, i: number) =>
    `[${i + 1}] ${c.title || c.url}\nURL: ${c.url}\nExcerpt: ${c.excerpt || 'No excerpt available'}`
  ).join('\n\n');

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: `You are an encyclopedia writer for Centipedia, a trust-weighted knowledge platform. Write a comprehensive, well-structured encyclopedia article about the given topic.

RULES:
- Write in an encyclopedic, neutral tone (similar to Wikipedia)
- Structure with clear sections using ## headings
- Reference the provided sources naturally in the text
- Be thorough but concise — aim for 600-1200 words
- Include a brief introduction paragraph before the first heading
- Do NOT include a title heading (it will be added separately)
- Do NOT include a references section (citations are handled separately)
- Write factual, verifiable content based on the sources provided

OUTPUT FORMAT:
Write the article in plain text with ## headings for sections. Use plain paragraphs, no bullet lists unless necessary.`
    },
    {
      role: 'user',
      content: `Write an encyclopedia article about: "${topic}"\n\nAvailable sources:\n\n${sourcesText}`
    }
  ];

  const result = await llm.complete(messages, { maxTokens: 2048 });
  const articleText = result.text.trim();

  if (articleText.length < 100) {
    logger.warn({ topic }, 'LLM produced insufficient content, skipping');
    return;
  }

  // Generate a slug rkey
  const rkey = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 64);

  // Build Leaflet-style blocks from the generated text
  const blocks = textToBlocks(articleText);

  // Publish to AT Protocol under bot DID
  const bot = await getCentipediaBot();
  if (!bot || !bot.session) {
    logger.error('Bot not available, cannot publish article');
    return;
  }

  const record = {
    $type: 'site.standard.document',
    title: topic,
    description: articleText.substring(0, 200).trim() + '…',
    publishedAt: new Date().toISOString(),
    content: {
      pages: [{
        $type: 'pub.leaflet.pages.linearDocument',
        blocks,
      }]
    }
  };

  try {
    const res = await bot.com.atproto.repo.putRecord({
      repo: bot.session.did,
      collection: 'site.standard.document',
      rkey,
      record,
    });

    logger.info({ uri: res.data.uri, topic, rkey }, 'Published synthesized article');

    // Link citations to the article
    const citationIds = citations.map((c: any) => c.id);
    await db.query(
      `UPDATE centipedia_citations SET article_rkey = $1 WHERE id = ANY($2::int[])`,
      [rkey, citationIds]
    );

    // Announce on Bluesky
    const articleUrl = `https://${config.CENTIPEDIA_DOMAIN}/post/${bot.session.did}/${rkey}`;
    await announceArticle(topic, articleUrl);

  } catch (err: any) {
    logger.error({ err, topic, rkey }, 'Failed to publish article to AT Protocol');
    throw err;
  }
}

/**
 * Convert generated markdown-ish text into Leaflet block format.
 */
function textToBlocks(text: string): any[] {
  const lines = text.split('\n');
  const blocks: any[] = [];
  let currentParagraph = '';

  function flushParagraph() {
    const trimmed = currentParagraph.trim();
    if (trimmed) {
      blocks.push({
        $type: 'pub.leaflet.pages.linearDocument#block',
        block: {
          $type: 'pub.leaflet.blocks.text',
          facets: [],
          plaintext: trimmed,
        }
      });
    }
    currentParagraph = '';
  }

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Heading
    const headingMatch = trimmedLine.match(/^(#{2,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({
        $type: 'pub.leaflet.pages.linearDocument#block',
        block: {
          $type: 'pub.leaflet.blocks.header',
          level: headingMatch[1].length,
          facets: [],
          plaintext: headingMatch[2].trim(),
        }
      });
      continue;
    }

    // Blockquote
    if (trimmedLine.startsWith('> ')) {
      flushParagraph();
      blocks.push({
        $type: 'pub.leaflet.pages.linearDocument#block',
        block: {
          $type: 'pub.leaflet.blocks.blockquote',
          facets: [],
          plaintext: trimmedLine.substring(2).trim(),
        }
      });
      continue;
    }

    // Empty line = paragraph break
    if (trimmedLine === '') {
      flushParagraph();
      continue;
    }

    // Accumulate paragraph text
    currentParagraph += (currentParagraph ? ' ' : '') + trimmedLine;
  }

  flushParagraph();
  return blocks;
}

// ─── Agent loop ──────────────────────────────────────────────────────────────

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const accepted = await processPendingCitations();
    if (accepted > 0) {
      const articles = await checkAndSynthesizeArticles();
      if (articles > 0) {
        logger.info({ articles }, 'Synthesis cycle produced new articles');
      }
    }
  } catch (err: any) {
    logger.error({ err }, 'Research agent tick failed');
  } finally {
    running = false;
  }
}

export function startResearchAgent() {
  logger.info({ pollInterval: POLL_INTERVAL_MS, minCitations: MIN_CITATIONS_FOR_ARTICLE },
    'Starting Centipedia research agent');

  // Run immediately, then on interval
  tick();
  const interval = setInterval(tick, POLL_INTERVAL_MS);

  return () => {
    clearInterval(interval);
    logger.info('Research agent stopped');
  };
}

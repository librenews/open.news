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
- Use inline citation markers like [1], [2], [3] to reference sources where claims are made
- Each citation marker corresponds to the numbered source in the Available Sources list
- Be thorough but concise — aim for 600-1200 words
- Include a brief introduction paragraph before the first heading
- Do NOT include a title heading (it will be added separately)
- Do NOT include a references section (citations are handled separately)
- Write factual, verifiable content based on the sources provided

OUTPUT FORMAT:
Write the article in plain text with ## headings for sections. Use plain paragraphs, no bullet lists unless necessary. Include [N] citation markers inline where you reference specific sources.`
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

  // Generate link keywords — maps key terms to citation indexes for inline external links
  let linkKeywords: { keyword: string; citationIndex: number }[] = [];
  try {
    const kwResult = await llm.complete([
      { role: 'system', content: `You extract link keywords from an article. Given article text and numbered sources, identify 1-3 key terms per source that should be hyperlinked to that source. Return ONLY a JSON array like: [{"keyword":"AT Protocol","citationIndex":1},{"keyword":"decentralized identifiers","citationIndex":3}]. Choose specific, meaningful terms (2-4 words). Do not pick single common words. Do not pick terms that appear in headings.` },
      { role: 'user', content: `Article:\n${articleText.substring(0, 2000)}\n\nSources:\n${sourcesText}` }
    ], { maxTokens: 500 });
    const jsonMatch = kwResult.text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      linkKeywords = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    logger.warn({ err, topic }, 'Failed to generate link keywords, continuing without');
  }

  // Generate a slug rkey
  const rkey = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 64);

  // Build Leaflet-style blocks from the generated text
  const blocks = textToBlocks(articleText);

  // Inject keyword link facets into text blocks
  injectKeywordFacets(blocks, linkKeywords, citations);

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

    // Save version snapshot with link keywords
    const wordCount = articleText.split(/\s+/).length;
    const contentHash = Buffer.from(articleText).toString('base64').substring(0, 64);
    const { rows: [{ max_version }] } = await db.query(
      'SELECT COALESCE(MAX(version), 0) AS max_version FROM centipedia_article_versions WHERE rkey = $1',
      [rkey]
    );
    await db.query(
      `INSERT INTO centipedia_article_versions (rkey, version, title, content_hash, word_count, citations_used, summary, generated_by, content_snapshot, link_keywords)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [rkey, Number(max_version) + 1, topic, contentHash, wordCount, citations.length,
       `Synthesized from ${citations.length} citations`, 'agent', JSON.stringify(blocks), JSON.stringify(linkKeywords)]
    );
    logger.info({ rkey, version: Number(max_version) + 1, keywords: linkKeywords.length }, 'Saved article version snapshot');

    // Announce on Bluesky
    const articleUrl = `https://${config.CENTIPEDIA_DOMAIN}/article/${rkey}`;
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
  let currentListItems: any[] = [];

  function stripInlineMarkdown(raw: string): { plaintext: string; facets: any[] } {
    const encoder = new TextEncoder();
    let plaintext = '';
    const facets: any[] = [];
    // Match **bold** and *italic*
    const re = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
    let lastIndex = 0;
    let match;
    while ((match = re.exec(raw)) !== null) {
      plaintext += raw.substring(lastIndex, match.index);
      const byteStart = encoder.encode(plaintext).length;
      const innerText = match[2] || match[3]; // bold or italic capture
      plaintext += innerText;
      const byteEnd = encoder.encode(plaintext).length;
      facets.push({
        index: { byteStart, byteEnd },
        features: [{ $type: match[2] ? 'pub.leaflet.richtext.facet#bold' : 'pub.leaflet.richtext.facet#italic' }]
      });
      lastIndex = re.lastIndex;
    }
    plaintext += raw.substring(lastIndex);
    return { plaintext, facets };
  }

  function flushListItems() {
    if (currentListItems.length > 0) {
      blocks.push({
        $type: 'pub.leaflet.pages.linearDocument#block',
        block: {
          $type: 'pub.leaflet.blocks.unorderedList',
          children: currentListItems,
        }
      });
      currentListItems = [];
    }
  }

  function flushParagraph() {
    const trimmed = currentParagraph.trim();
    if (trimmed) {
      const { plaintext, facets } = stripInlineMarkdown(trimmed);
      blocks.push({
        $type: 'pub.leaflet.pages.linearDocument#block',
        block: {
          $type: 'pub.leaflet.blocks.text',
          facets,
          plaintext,
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
      flushListItems();
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

    // List item (- or *)
    const listMatch = trimmedLine.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      const { plaintext, facets } = stripInlineMarkdown(listMatch[1]);
      currentListItems.push({
        content: {
          $type: 'pub.leaflet.blocks.text',
          facets,
          plaintext,
        }
      });
      continue;
    }

    // If we had list items and now hit a non-list line, flush the list
    if (currentListItems.length > 0 && !listMatch) {
      flushListItems();
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
  flushListItems();
  return blocks;
}

/**
 * Inject keyword link facets into text blocks.
 * For each keyword, find the first occurrence in a text block and add a
 * byte-range facet with app.bsky.richtext.facet#link pointing to the source URL.
 */
function injectKeywordFacets(
  blocks: any[],
  keywords: { keyword: string; citationIndex: number }[],
  citations: { id: number; url: string; title?: string | null; excerpt?: string | null }[]
): void {
  if (!keywords || keywords.length === 0) return;
  const linked = new Set<string>();
  const encoder = new TextEncoder();

  for (const kw of keywords) {
    const kwLower = kw.keyword.toLowerCase();
    if (linked.has(kwLower)) continue;
    const idx = kw.citationIndex - 1; // 1-indexed
    if (idx < 0 || idx >= citations.length) continue;
    const url = citations[idx].url;
    if (!url) continue;

    // Search through text blocks for first occurrence
    for (const block of blocks) {
      const inner = block.block;
      if (!inner || inner.$type !== 'pub.leaflet.blocks.text') continue;
      const plaintext: string = inner.plaintext || '';
      const matchIdx = plaintext.toLowerCase().indexOf(kwLower);
      if (matchIdx === -1) continue;

      // Calculate byte offsets (AT Protocol uses UTF-8 byte indexes)
      const beforeBytes = encoder.encode(plaintext.substring(0, matchIdx));
      const matchBytes = encoder.encode(plaintext.substring(matchIdx, matchIdx + kw.keyword.length));

      inner.facets = inner.facets || [];
      inner.facets.push({
        index: {
          byteStart: beforeBytes.length,
          byteEnd: beforeBytes.length + matchBytes.length,
        },
        features: [{
          $type: 'app.bsky.richtext.facet#link',
          uri: url,
        }]
      });

      linked.add(kwLower);
      break; // Only link first occurrence across all blocks
    }
  }
}

// ─── Article regeneration ────────────────────────────────────────────────────

const MIN_NEW_CITATIONS_FOR_REGEN = 2;

async function checkAndRegenerateArticles(): Promise<number> {
  // Find topics where new accepted citations exist but aren't linked to the article yet
  const { rows: regenTopics } = await db.query(
    `SELECT c.topic, 
       (SELECT article_rkey FROM centipedia_citations WHERE topic = c.topic AND article_rkey IS NOT NULL LIMIT 1) AS existing_rkey,
       count(*) AS new_count
     FROM centipedia_citations c
     WHERE c.status = 'accepted' AND c.article_rkey IS NULL AND c.topic IS NOT NULL
       AND EXISTS (SELECT 1 FROM centipedia_citations c2 WHERE c2.topic = c.topic AND c2.article_rkey IS NOT NULL)
     GROUP BY c.topic
     HAVING count(*) >= $1
     ORDER BY new_count DESC LIMIT 3`,
    [MIN_NEW_CITATIONS_FOR_REGEN]
  );

  let regenerated = 0;
  for (const { topic, existing_rkey, new_count } of regenTopics) {
    logger.info({ topic, newCitations: new_count, rkey: existing_rkey }, 'Regenerating article with new citations');
    try {
      await regenerateArticle(topic, existing_rkey);
      regenerated++;
    } catch (err: any) {
      logger.error({ err, topic }, 'Article regeneration failed');
    }
  }

  return regenerated;
}

async function regenerateArticle(topic: string, rkey: string): Promise<void> {
  // Gather ALL accepted citations for this topic (old + new)
  const { rows: allCitations } = await db.query(
    `SELECT id, url, title, excerpt FROM centipedia_citations
     WHERE status = 'accepted' AND topic = $1
     ORDER BY created_at ASC`,
    [topic]
  );

  if (allCitations.length < MIN_CITATIONS_FOR_ARTICLE) return;

  const sourcesText = allCitations.map((c: any, i: number) =>
    `[${i + 1}] ${c.title || c.url}\nURL: ${c.url}\nExcerpt: ${c.excerpt || 'No excerpt available'}`
  ).join('\n\n');

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: `You are an encyclopedia writer for Centipedia. An article about "${topic}" already exists but new sources have been added. Rewrite the article incorporating ALL the provided sources for a more comprehensive, up-to-date entry.

RULES:
- Write in an encyclopedic, neutral tone (similar to Wikipedia)
- Structure with clear sections using ## headings
- Use inline citation markers like [1], [2], [3] to reference sources where claims are made
- Each citation marker corresponds to the numbered source in the Available Sources list
- Be thorough but concise — aim for 800-1500 words (longer than initial version since more sources)
- Include a brief introduction paragraph before the first heading
- Do NOT include a title heading (it will be added separately)
- Do NOT include a references section (citations are handled separately)
- Write factual, verifiable content based on the sources provided`
    },
    {
      role: 'user',
      content: `Rewrite the encyclopedia article about: "${topic}"\n\nAll available sources (${allCitations.length} total):\n\n${sourcesText}`
    }
  ];

  const result = await llm.complete(messages, { maxTokens: 3000 });
  const articleText = result.text.trim();

  if (articleText.length < 100) {
    logger.warn({ topic }, 'LLM produced insufficient content for regeneration, skipping');
    return;
  }

  // Generate link keywords for regenerated article
  let linkKeywords: { keyword: string; citationIndex: number }[] = [];
  try {
    const kwResult = await llm.complete([
      { role: 'system', content: `You extract link keywords from an article. Given article text and numbered sources, identify 1-3 key terms per source that should be hyperlinked to that source. Return ONLY a JSON array like: [{"keyword":"AT Protocol","citationIndex":1},{"keyword":"decentralized identifiers","citationIndex":3}]. Choose specific, meaningful terms (2-4 words). Do not pick single common words. Do not pick terms that appear in headings.` },
      { role: 'user', content: `Article:\n${articleText.substring(0, 2000)}\n\nSources:\n${sourcesText}` }
    ], { maxTokens: 500 });
    const jsonMatch = kwResult.text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      linkKeywords = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    logger.warn({ err, topic }, 'Failed to generate link keywords for regeneration');
  }

  const blocks = textToBlocks(articleText);

  // Inject keyword link facets into text blocks
  injectKeywordFacets(blocks, linkKeywords, allCitations);

  const bot = await getCentipediaBot();
  if (!bot || !bot.session) {
    logger.error('Bot not available, cannot regenerate article');
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
    await bot.com.atproto.repo.putRecord({
      repo: bot.session.did,
      collection: 'site.standard.document',
      rkey,
      record,
    });

    logger.info({ topic, rkey, totalCitations: allCitations.length }, 'Regenerated article');

    // Link the new citations to the article
    const unlinkedIds = allCitations.filter((c: any) => !c.article_rkey).map((c: any) => c.id);
    if (unlinkedIds.length > 0) {
      await db.query(
        `UPDATE centipedia_citations SET article_rkey = $1 WHERE id = ANY($2::int[])`,
        [rkey, unlinkedIds]
      );
    }

    // Save version snapshot with link keywords
    const wordCount = articleText.split(/\s+/).length;
    const contentHash = Buffer.from(articleText).toString('base64').substring(0, 64);
    const { rows: [{ max_version }] } = await db.query(
      'SELECT COALESCE(MAX(version), 0) AS max_version FROM centipedia_article_versions WHERE rkey = $1',
      [rkey]
    );
    await db.query(
      `INSERT INTO centipedia_article_versions (rkey, version, title, content_hash, word_count, citations_used, summary, generated_by, content_snapshot, link_keywords)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [rkey, Number(max_version) + 1, topic, contentHash, wordCount, allCitations.length,
       `Regenerated with ${allCitations.length} citations (+${unlinkedIds.length} new)`, 'agent', JSON.stringify(blocks), JSON.stringify(linkKeywords)]
    );
    logger.info({ rkey, version: Number(max_version) + 1, keywords: linkKeywords.length }, 'Saved regenerated article version');

    // Announce regeneration on Bluesky
    const articleUrl = `https://${config.CENTIPEDIA_DOMAIN}/article/${rkey}`;
    await announceArticle(topic, articleUrl, true);

  } catch (err: any) {
    logger.error({ err, topic, rkey }, 'Failed to regenerate article');
    throw err;
  }
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
      // Also check if existing articles need regeneration
      const regenerated = await checkAndRegenerateArticles();
      if (regenerated > 0) {
        logger.info({ regenerated }, 'Regeneration cycle updated articles');
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

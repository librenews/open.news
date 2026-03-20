import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export interface TextExtractionResult {
  fullText: string | null;
  wordCount: number;
}

export function extractArticleText(html: string, url: string): TextExtractionResult {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent) {
      return { fullText: null, wordCount: 0 };
    }

    const fullText = article.textContent.trim();
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;

    return { fullText, wordCount };
  } catch {
    return { fullText: null, wordCount: 0 };
  }
}

export const supportedLexicons = {
  blog: 'app.bsky.feed.post', 
  sapphire: 'app.bsky.feed.post', 
  longform: 'app.bsky.feed.post',
  whitewind: 'com.whtwnd.blog.entry',
  leaflet: 'pub.leaflet.document',
  default: 'app.bsky.feed.post', // All posts use standard Bluesky format
} as const;

export type LexiconKey = keyof typeof supportedLexicons;

export function getLexiconByCategory(categories: string[] = []): string {
  for (const category of categories) {
    const normalized = category.toLowerCase() as LexiconKey;
    if (supportedLexicons[normalized]) {
      return supportedLexicons[normalized];
    }
  }
  return supportedLexicons.default;
}

// New function to get lexicon from custom field or direct parameter
export function getLexiconFromPost(lexiconParam?: string, categories: string[] = []): string {
  // First check direct lexicon parameter
  if (lexiconParam) {
    const normalized = lexiconParam.toLowerCase() as LexiconKey;
    if (supportedLexicons[normalized]) {
      return supportedLexicons[normalized];
    }
    // If lexicon param is a full collection name, return it directly
    if (lexiconParam.includes('.')) {
      return lexiconParam;
    }
    console.log('Lexicon parameter not recognized:', lexiconParam);
  }
  
  // Fallback to category-based detection for backward compatibility
  console.log('Falling back to category-based detection');
  const result = getLexiconByCategory(categories);
  console.log('Category-based result:', result);
  return result;
}

export function getLexiconInfo() {
  return {
    supported: Object.keys(supportedLexicons),
    default: supportedLexicons.default,
    descriptions: {
      blog: 'Standard Bluesky post (280 chars max, auto-threads longer content)',
      sapphire: 'Standard Bluesky post (same as blog)',
      longform: 'Standard Bluesky post with automatic threading support',
      whitewind: 'Whitewind blog entry (long-form content, titles, full HTML support)',
      leaflet: 'Leaflet document (block-based long-form content)',
    },
    limits: {
      maxSinglePost: 280,
      threadSupport: true,
      autoThreading: true,
      lexiconsImplemented: false, // Currently all map to standard posts
    },
    note: 'Blog/sapphire/longform map to standard Bluesky posts (app.bsky.feed.post). Whitewind creates blog entries (com.whtwnd.blog.entry). Leaflet creates distinct documents (pub.leaflet.document)'
  };
}

// Whitewind blog entry interface
export interface WhitewindBlogEntry {
  $type: 'com.whtwnd.blog.entry';
  content: string;
  createdAt: string;
  title?: string;
  subtitle?: string;
  visibility?: 'public' | 'url' | 'author';
}

// Create a Whitewind blog entry record
export function createWhitewindEntry(
  title: string, 
  content: string, 
  subtitle?: string
): WhitewindBlogEntry {
  const entry: WhitewindBlogEntry = {
    $type: 'com.whtwnd.blog.entry',
    content,
    createdAt: new Date().toISOString(),
    title,
    visibility: 'public'
  };
  
  if (subtitle) {
    entry.subtitle = subtitle;
  }
  
  return entry;
}

// Check if a lexicon is Whitewind
export function isWhitewindLexicon(lexicon: string): boolean {
  return lexicon === 'com.whtwnd.blog.entry';
}

// Leaflet document interfaces
export interface LeafletBlock {
  $type: 'pub.leaflet.pages.linearDocument#block';
  block: {
    $type: 'pub.leaflet.blocks.text';
    facets: any[];
    plaintext: string;
  };
}

export interface LeafletLinearDocument {
  $type: 'pub.leaflet.pages.linearDocument';
  blocks: LeafletBlock[];
}

export interface LeafletDocument {
  $type: 'pub.leaflet.document';
  title?: string;
  author?: string;
  description?: string;
  publication?: string;
  publishedAt: string;
  pages: LeafletLinearDocument[];
}

// Create a Leaflet document record
export function createLeafletEntry(
  title: string,
  content: string,
  did: string,
  excerpt?: string
): LeafletDocument {
  // basic paragraph extraction for simplest block support
  const paragraphs = content.split('\n\n').map(p => p.trim()).filter(p => p.length > 0);
  const blocks: LeafletBlock[] = paragraphs.map(p => ({
    $type: 'pub.leaflet.pages.linearDocument#block',
    block: {
      $type: 'pub.leaflet.blocks.text',
      facets: [],
      plaintext: p
    }
  }));

  if (blocks.length === 0) {
    blocks.push({
      $type: 'pub.leaflet.pages.linearDocument#block',
      block: { $type: 'pub.leaflet.blocks.text', facets: [], plaintext: content }
    });
  }

  return {
    $type: 'pub.leaflet.document',
    title: title || 'Untitled',
    description: excerpt || '',
    author: did,
    publishedAt: new Date().toISOString(),
    pages: [
      {
        $type: 'pub.leaflet.pages.linearDocument',
        blocks
      }
    ]
  };
}

// Check if a lexicon is Leaflet
export function isLeafletLexicon(lexicon: string): boolean {
  return lexicon === 'pub.leaflet.document';
}

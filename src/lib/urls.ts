import normalizeUrl from 'normalize-url';

// Tracking params to strip from URLs
const STRIP_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid', '_ga',
  'twclid', 'igshid', 'yclid',
];

export function normalizeArticleUrl(raw: string): string | null {
  try {
    const url = new URL(raw);

    // Remove trailing slash on bare domains
    if (url.pathname === '/' || url.pathname === '') {
      url.pathname = '';
    }

    // Strip tracking params
    for (const param of STRIP_PARAMS) {
      url.searchParams.delete(param);
    }

    // Also strip any param starting with utm_
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_')) url.searchParams.delete(key);
    }

    return normalizeUrl(url.toString(), {
      stripHash: true,
      stripWWW: false,   // preserve www — different sites may use both
      removeTrailingSlash: true,
      sortQueryParameters: true,
    });
  } catch {
    return null;
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Extract URLs from a Bluesky post record.
 * Uses facets (authoritative) and embed.external.uri.
 */
export function extractUrlsFromPost(post: {
  facets?: Array<{
    features?: Array<{ $type: string; uri?: string }>;
  }>;
  embed?: {
    $type?: string;
    external?: { uri?: string };
  };
}): string[] {
  const urls: string[] = [];

  // From facets — the authoritative source for links in Bluesky
  if (Array.isArray(post.facets)) {
    for (const facet of post.facets) {
      if (!Array.isArray(facet.features)) continue;
      for (const feature of facet.features) {
        if (feature.$type === 'app.bsky.richtext.facet#link' && feature.uri) {
          urls.push(feature.uri);
        }
      }
    }
  }

  // From embed.external
  if (
    post.embed?.$type === 'app.bsky.embed.external' &&
    post.embed.external?.uri
  ) {
    urls.push(post.embed.external.uri);
  }

  return [...new Set(urls)]; // deduplicate
}

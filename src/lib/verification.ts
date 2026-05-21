import { logger } from './logger.js';
import { db } from '../db/client.js';

// ── Publication verification cache ───────────────────────────────────────────
// Caches verified publication domains to avoid re-checking every document.
// Key: publication AT-URI, Value: { verified, checkedAt }
const pubVerificationCache = new Map<string, { verified: boolean; checkedAt: number }>();
const PUB_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Verify a site.standard.publication by checking its domain's .well-known endpoint.
 * Returns true if the domain serves `/.well-known/site.standard.publication` and
 * the returned AT-URI matches the record's URI.
 */
export async function verifyPublication(pubUri: string, pubUrl: string): Promise<boolean> {
  // Check cache first
  const cached = pubVerificationCache.get(pubUri);
  if (cached && Date.now() - cached.checkedAt < PUB_CACHE_TTL_MS) {
    return cached.verified;
  }

  // Also check DB cache
  try {
    const { rows } = await db.query(
      'SELECT verified, verified_at FROM site_publications WHERE uri = $1 AND verified IS NOT NULL AND verified_at > NOW() - INTERVAL \'24 hours\'',
      [pubUri]
    );
    if (rows.length > 0) {
      const v = rows[0].verified;
      pubVerificationCache.set(pubUri, { verified: v, checkedAt: Date.now() });
      return v;
    }
  } catch {}

  let verified = false;
  try {
    // Extract domain from publication URL
    const url = new URL(pubUrl);
    const wellKnownUrl = `${url.origin}/.well-known/site.standard.publication`;

    const response = await fetch(wellKnownUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'open-news-verifier/1.0' },
      redirect: 'follow',
    });

    if (response.ok) {
      const body = (await response.text()).trim();
      verified = body === pubUri;
      if (!verified) {
        logger.debug({ pubUri, wellKnownUrl, returned: body }, 'Publication verification mismatch');
      }
    }
  } catch (err) {
    logger.debug({ err, pubUri, pubUrl }, 'Publication verification fetch failed (non-fatal)');
  }

  // Update caches
  pubVerificationCache.set(pubUri, { verified, checkedAt: Date.now() });
  try {
    await db.query(
      'UPDATE site_publications SET verified = $1, verified_at = NOW() WHERE uri = $2',
      [verified, pubUri]
    );
  } catch {}

  return verified;
}

/**
 * Verify a site.standard.document by checking for a <link rel="site.standard.document">
 * tag in the page's HTML that matches the document's AT-URI.
 * 
 * If the document's publication is already verified, we cascade that trust
 * (the document inherits verification from its publication).
 */
export async function verifyDocument(
  docUri: string,
  site: string | null,
  path: string | null,
  publicationUri?: string | null
): Promise<boolean> {
  // If the publication AT-URI is set, check if the publication is verified first.
  // Documents under a verified publication inherit verification.
  if (publicationUri) {
    try {
      const { rows } = await db.query(
        'SELECT verified, url FROM site_publications WHERE uri = $1',
        [publicationUri]
      );
      if (rows.length > 0) {
        if (rows[0].verified === true) {
          // Publication is verified — cascade to document
          return true;
        }
        // If publication wasn't verified, try re-verifying it
        if (rows[0].url) {
          const pubVerified = await verifyPublication(publicationUri, rows[0].url);
          if (pubVerified) return true;
        }
      }
    } catch {}
  }

  // Fall back to per-document verification via <link> tag
  if (!site || !path) return false;

  try {
    const pageUrl = site.startsWith('http')
      ? `${site.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`
      : null;

    if (!pageUrl) return false;

    const response = await fetch(pageUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'open-news-verifier/1.0' },
      redirect: 'follow',
    });

    if (!response.ok) return false;

    // Only read first 16KB to find the <head> section
    const reader = response.body?.getReader();
    if (!reader) return false;

    let html = '';
    const decoder = new TextDecoder();
    while (html.length < 16384) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      // Stop early if we've passed </head>
      if (html.includes('</head>')) break;
    }
    reader.cancel();

    // Look for <link rel="site.standard.document" href="at://...">
    const match = html.match(/<link[^>]*rel=["']site\.standard\.document["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i)
      || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']site\.standard\.document["'][^>]*\/?>/i);

    if (match && match[1].trim() === docUri) {
      return true;
    }
  } catch (err) {
    logger.debug({ err, docUri, site, path }, 'Document verification fetch failed (non-fatal)');
  }

  return false;
}

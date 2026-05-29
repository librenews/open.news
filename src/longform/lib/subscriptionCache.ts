import { BskyAgent } from '@atproto/api';
import { resolvePds } from '../../lib/pds.js';
import { logger } from '../../lib/logger.js';

/**
 * Caches a viewer's site.standard.graph.subscription records
 * so we don't re-fetch from their PDS on every feed request.
 */
interface SubCacheEntry {
  publicationUris: string[];
  fetchedAt: number;
}

const cache = new Map<string, SubCacheEntry>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Get the list of publication AT-URIs a user is subscribed to.
 * Fetches from PDS and caches for 30 minutes.
 */
export async function getSubscribedPublications(did: string): Promise<string[]> {
  const cached = cache.get(did);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.publicationUris;
  }

  try {
    const pdsEndpoint = await resolvePds(did);
    if (!pdsEndpoint) {
      cache.set(did, { publicationUris: [], fetchedAt: Date.now() });
      return [];
    }

    const agent = new BskyAgent({ service: pdsEndpoint });
    const res = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: 'site.standard.graph.subscription',
      limit: 100,
    });

    const pubUris: string[] = [];
    for (const record of res.data.records) {
      const val = record.value as any;
      if (val?.publication && typeof val.publication === 'string') {
        pubUris.push(val.publication);
      }
    }

    cache.set(did, { publicationUris: pubUris, fetchedAt: Date.now() });
    logger.debug({ did, count: pubUris.length }, 'Cached subscriptions for viewer');
    return pubUris;
  } catch (err) {
    logger.warn({ err, did }, 'Failed to fetch subscriptions from PDS');
    // Cache empty result for 5 minutes to avoid hammering
    cache.set(did, { publicationUris: [], fetchedAt: Date.now() - CACHE_TTL_MS + 5 * 60 * 1000 });
    return [];
  }
}

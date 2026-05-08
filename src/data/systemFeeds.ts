/**
 * System feed definitions — pre-built topic feeds published as Bluesky custom feeds.
 * These are created under the track.social system user account.
 * No keyword or track count limits apply to system feeds.
 */

export interface SystemFeedDef {
  name: string;
  query: string;
  keywords: string[];
  threshold: number;
  description: string;
  category: 'broad' | 'niche' | 'geographic';
}

// ─── Niche Feeds (high discovery, low competition) ──────────────────────────

const niche: SystemFeedDef[] = [
  {
    name: 'AT Protocol & Bluesky',
    query: 'AT Protocol development, Bluesky features, decentralized social networking, federation',
    keywords: ['atproto', 'at protocol', 'bluesky', 'bsky', 'decentralized social', 'federation', 'PDS', 'lexicon', 'firehose', 'did:plc'],
    threshold: 0.70,
    description: 'News and discussions about the AT Protocol, Bluesky, and the decentralized social web.',
    category: 'niche',
  },
  {
    name: 'Open Source & FOSS',
    query: 'open source software projects, free software, FOSS community, open source licensing and contributions',
    keywords: ['open source', 'FOSS', 'libre software', 'GPL', 'MIT license', 'Apache license', 'github', 'gitlab', 'linux', 'debian', 'fedora', 'FreeBSD', 'contributor'],
    threshold: 0.70,
    description: 'Open source software news, releases, community updates, and licensing discussions.',
    category: 'niche',
  },
  {
    name: 'Indie Web & Blogging',
    query: 'personal websites, independent web publishing, blogging platforms, self-hosting, RSS feeds',
    keywords: ['indieweb', 'personal website', 'blogging', 'self-hosting', 'RSS', 'webmention', 'microformats', 'small web', 'digital garden', 'static site', 'hugo', 'jekyll', '11ty'],
    threshold: 0.70,
    description: 'The indie web movement: personal sites, blogging, RSS, self-hosting, and owning your content.',
    category: 'niche',
  },
  {
    name: 'Data Privacy & Rights',
    query: 'data privacy legislation, digital rights, surveillance, GDPR enforcement, right to encryption',
    keywords: ['privacy', 'GDPR', 'surveillance', 'digital rights', 'encryption', 'data protection', 'EFF', 'ACLU', 'right to privacy', 'end-to-end encryption', 'metadata'],
    threshold: 0.70,
    description: 'Privacy law, digital rights, surveillance news, and the fight for data protection.',
    category: 'niche',
  },
  {
    name: 'Local-First Software',
    query: 'local-first software, CRDTs, offline-first applications, peer-to-peer computing, edge computing',
    keywords: ['local-first', 'CRDT', 'offline-first', 'peer-to-peer', 'p2p', 'sync engine', 'automerge', 'yjs', 'electric-sql', 'replicache'],
    threshold: 0.72,
    description: 'Local-first and offline-first software: CRDTs, sync engines, P2P, and edge computing.',
    category: 'niche',
  },
];

// ─── Geographic Feeds (low competition, scales by quantity) ─────────────────

function geoFeed(city: string, region?: string): SystemFeedDef {
  const location = region ? `${city}, ${region}` : city;
  return {
    name: `${city} News`,
    query: `local news, events, politics, and community developments in ${location}`,
    keywords: [city.toLowerCase(), location.toLowerCase()],
    threshold: 0.68,
    description: `News and discussions about ${location} — local politics, events, development, and community.`,
    category: 'geographic',
  };
}

const geographic: SystemFeedDef[] = [
  // US cities
  geoFeed('New York City', 'NY'),
  geoFeed('Los Angeles', 'CA'),
  geoFeed('Chicago', 'IL'),
  geoFeed('San Francisco', 'CA'),
  geoFeed('Seattle', 'WA'),
  geoFeed('Austin', 'TX'),
  geoFeed('Portland', 'OR'),
  geoFeed('Denver', 'CO'),
  geoFeed('Washington', 'DC'),
  geoFeed('Philadelphia', 'PA'),
  geoFeed('Atlanta', 'GA'),
  geoFeed('Miami', 'FL'),
  geoFeed('Minneapolis', 'MN'),
  geoFeed('Nashville', 'TN'),
  geoFeed('Pittsburgh', 'PA'),
  geoFeed('Detroit', 'MI'),
  geoFeed('Boston', 'MA'),
  geoFeed('Raleigh', 'NC'),
  geoFeed('Salt Lake City', 'UT'),
  geoFeed('New Orleans', 'LA'),
  // International
  geoFeed('Toronto', 'Canada'),
  geoFeed('Vancouver', 'Canada'),
  geoFeed('London', 'UK'),
  geoFeed('Berlin', 'Germany'),
  geoFeed('Amsterdam', 'Netherlands'),
];

export const SYSTEM_FEEDS: SystemFeedDef[] = [...niche, ...geographic];

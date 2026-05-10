/**
 * Publish a mock article under the Centipedia bot account for testing the reader.
 * Usage: node --env-file=.env --import tsx/esm src/centipedia/scripts/mock-article.ts
 */
import { BskyAgent } from '@atproto/api';

const handle = process.env.CENTIPEDIA_BSKY_HANDLE!;
const password = process.env.CENTIPEDIA_BSKY_PASSWORD!;

async function main() {
  const agent = new BskyAgent({ service: 'https://bsky.social' });
  await agent.login({ identifier: handle, password });
  console.log('Logged in as', handle, '- DID:', agent.session?.did);

  const rkey = 'at-protocol-decentralization';

  const record = {
    $type: 'site.standard.document',
    title: 'The AT Protocol and the Future of Decentralized Knowledge',
    description: 'How the Authenticated Transfer Protocol enables a new model for collaborative, trust-weighted knowledge synthesis.',
    publishedAt: new Date().toISOString(),
    content: {
      pages: [{
        $type: 'pub.leaflet.pages.linearDocument',
        blocks: [
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.text',
              facets: [],
              plaintext: 'The Authenticated Transfer Protocol (AT Protocol) represents a fundamental shift in how we think about online identity, data ownership, and social interaction. Originally developed by Bluesky to power a decentralized social network, AT Protocol\'s design principles extend far beyond microblogging — into knowledge management, collaborative research, and trust-weighted information systems.'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.header',
              level: 2,
              facets: [],
              plaintext: 'What Makes AT Protocol Different'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.text',
              facets: [],
              plaintext: 'Unlike traditional web platforms where data lives on company servers, AT Protocol stores user data in Personal Data Servers (PDS). Each user has a Decentralized Identifier (DID) that remains constant even if they move between service providers. This creates a portable, verifiable identity layer that existing platforms simply cannot offer.'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.text',
              facets: [],
              plaintext: 'The protocol\'s data model uses lexicons — schema definitions that describe record types. Any developer can define new lexicons, enabling the ecosystem to grow organically without permission from a central authority. This is how Centipedia defines its own record types for citations and endorsements while remaining fully interoperable with the broader AT Protocol network.'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.header',
              level: 2,
              facets: [],
              plaintext: 'Trust Without Central Authority'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.text',
              facets: [],
              plaintext: 'Wikipedia solved the knowledge organization problem through centralized editorial consensus. A small group of dedicated editors maintains quality through bureaucratic processes, edit wars, and administrative hierarchies. This works, but it creates a single point of failure and a single version of truth that may not serve all communities equally.'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.text',
              facets: [],
              plaintext: 'AT Protocol enables a different model: trust without central authority. Because every user\'s social graph, endorsements, and contributions are stored on their own PDS and are publicly verifiable, trust can be computed relative to each reader. You don\'t need Wikipedia\'s administrators to tell you what\'s reliable — your own network of trusted sources does that.'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.header',
              level: 2,
              facets: [],
              plaintext: 'The Endorsement Graph'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.text',
              facets: [],
              plaintext: 'Centipedia introduces three types of trust signals, all stored as AT Protocol records on each user\'s PDS: citation endorsements ("this source is credible"), submitter endorsements ("I trust this person\'s judgment"), and source endorsements ("I trust this domain"). These explicit signals are far more meaningful than social follows, which are noisy — people follow politicians they disagree with, entertainers, and accounts they hate-read.'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.blockquote',
              facets: [],
              plaintext: 'The key insight is that AI is replayable. Articles are ephemeral outputs — generated content that can be regenerated at any time. The durable, decentralized data is the trust graph itself.'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.header',
              level: 2,
              facets: [],
              plaintext: 'Resilience Through Decentralization'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.text',
              facets: [],
              plaintext: 'Because all citations and endorsements live on users\' PDS records, the knowledge graph survives independently of any single service. If centipedia.org were to disappear tomorrow, every citation record would still sit on each user\'s PDS. Every endorsement would still be verifiable. Anyone could stand up a new instance, crawl the AT Protocol network for those records, and regenerate every article with the same trust weighting.'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.text',
              facets: [],
              plaintext: 'This represents a new paradigm for knowledge infrastructure: the rendering layer is replaceable, but the trust graph is permanent and user-owned. No company, no government, and no algorithm can take away the relationships and endorsements that users have built.'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.header',
              level: 3,
              facets: [],
              plaintext: 'Technical Implementation'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.text',
              facets: [],
              plaintext: 'The Centipedia service watches the AT Protocol firehose via Jetstream, indexing citation and endorsement records as they\'re created. Articles are synthesized by AI agents that connect to collaborative editing documents via WebSocket. The entire pipeline — from citation submission to article publication — is auditable and reproducible.'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.code',
              facets: [],
              plaintext: '// Trust signal hierarchy\nStrong ──► Explicit endorsement of citation     (1.0)\n       ──► Explicit endorsement of submitter    (0.8)\n       ──► Explicit endorsement of source domain (0.5)\nWeak   ──► Social follow (fallback only)         (0.2)\n       ──► Agent-crawled, no human endorsement   (0.05)'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.header',
              level: 2,
              facets: [],
              plaintext: 'Looking Forward'
            }
          },
          {
            $type: 'pub.leaflet.pages.linearDocument#block',
            block: {
              $type: 'pub.leaflet.blocks.text',
              facets: [],
              plaintext: 'The AT Protocol is still young, but its architecture is uniquely suited for knowledge systems that need to balance openness with trust, collaboration with ownership, and AI assistance with human judgment. Centipedia is an early experiment in this space — one that bets on the idea that the best encyclopedia isn\'t the one with the most editors, but the one that lets each reader see knowledge through the lens of the people they trust most.'
            }
          },
        ]
      }]
    }
  };

  try {
    const result = await agent.com.atproto.repo.putRecord({
      repo: agent.session!.did,
      collection: 'site.standard.document',
      rkey,
      record,
    });
    console.log('✅ Published mock article:', result.data.uri);
    console.log(`\nView at: http://localhost:${process.env.CENTIPEDIA_PORT || 3001}/post/${agent.session!.did}/${rkey}`);
  } catch (err: any) {
    console.error('Failed to publish:', err.message);
    if (err.status) console.error('Status:', err.status, err.body);
  }
}

main().catch(console.error);

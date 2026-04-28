# AT Protocol Cookbook

Welcome to the **AT Protocol Cookbook**. 

The AT Protocol is the decentralized engine powering Bluesky and a rapidly growing ecosystem of independent federated apps. While the official documentation is excellent for understanding the abstract architecture—Lexicons, Merkle Search Trees, and DID Resolution—there is a massive void for a practical, hands-on guide.

This book is written for developers. It cuts through the academic theory and gets straight to the actual implementation patterns. If you want to know exactly how to connect to the firehose, calculate rich-text byte facets, build a custom feed, or upload media blobs directly to a PDS, you are in the right place.

All code examples in this book are battle-tested and drawn directly from production environments.

## Table of Contents

1. [Chapter 1: Drinking from the Firehose](chapter-01-firehose.md)
   - Connecting to the WebSocket firehose
   - Decoding CBOR payloads
   - Identifying posts, likes, and follows
2. [Chapter 2: Building Custom Feeds (Feed Generators) *[Coming Soon]*](chapter-02-custom-feeds.md)
   - Setting up a skeleton endpoint
   - Handling pagination and cursors
   - Semantic filtering
3. [Chapter 3: XRPC Authentication & The PDS *[Coming Soon]*](chapter-03-xrpc-auth.md)
   - App Passwords and Sessions
   - DID to Handle Resolution
   - Writing to the PDS securely
4. [Chapter 4: The Dark Art of Rich Text *[Coming Soon]*](chapter-04-rich-text.md)
   - UTF-8 byte bounds vs. string lengths
   - Generating `@mentions` and `#hashtags` safely
5. [Chapter 5: Custom Lexicons & POSSE *[Coming Soon]*](chapter-05-custom-lexicons.md)
   - Publishing `site.standard.document`
   - Mapping HTML AST to AT JSON
   - Domain verification via `/.well-known`
6. [Chapter 6: Media & Decentralized Blobs *[Coming Soon]*](chapter-06-media-blobs.md)
   - Uploading binary blobs
   - Understanding cryptographic CIDs
   - Building a decentralized media CDN

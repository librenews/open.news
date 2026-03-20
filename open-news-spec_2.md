# open.news — MVP Technical Specification

**Version:** 1.0  
**Stack:** Node.js + TypeScript, PostgreSQL, pg-boss, Caddy, PM2  
**Target:** Single VPS (Hetzner CX21 or DigitalOcean equivalent)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Repository Structure](#3-repository-structure)
4. [Environment Configuration](#4-environment-configuration)
5. [Database Schema & Migrations](#5-database-schema--migrations)
6. [API Server](#6-api-server)
7. [Jetstream Consumer](#7-jetstream-consumer)
8. [Job Queue & Workers](#8-job-queue--workers)
9. [Article Detection Pipeline](#9-article-detection-pipeline)
10. [Article Text Extraction & LLM Context](#10-article-text-extraction--llm-context)
11. [Bot: Mention & DM Handler](#11-bot-mention--dm-handler)
12. [LLM Abstraction Layer](#12-llm-abstraction-layer)
13. [Deploy Setup](#13-deploy-setup)
14. [Operational Runbook](#14-operational-runbook)
15. [MVP Boundaries & Future Work](#15-mvp-boundaries--future-work)

---

## 1. Project Overview

open.news is an agentic news reader powered by your Bluesky social graph. Users sign in via Bluesky OAuth. The system monitors the posts of their followed accounts, detects news article links, fetches and analyzes those articles, and surfaces them as a personalized feed. A Bluesky bot account (`@open.news`) responds to mentions and DMs with news answers contextualized to the user's reading history.

### Core User Journey

1. User visits open.news and authenticates via Bluesky OAuth
2. System imports their follow graph as sources
3. Jetstream consumer monitors those sources in near real-time
4. New URLs are detected, deduplicated, fetched, analyzed, and stored
5. Articles appear in the user's feed
6. User (or anyone) mentions or DMs `@open.news` → bot answers using their article context

---

## 2. Architecture Overview

### Three Processes (managed by PM2)

```
┌─────────────────────────────────────────────┐
│                   PM2                        │
│                                             │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐ │
│  │   web    │  │ firehose  │  │  worker  │ │
│  │ (Hono)   │  │(Jetstream)│  │(pg-boss) │ │
│  │ :3000    │  │           │  │          │ │
│  └──────────┘  └───────────┘  └──────────┘ │
└─────────────────────────────────────────────┘
         │               │              │
         └───────────────┴──────────────┘
                         │
                   PostgreSQL
                  (single DB)
```

**web** — Hono HTTP server. Handles OAuth flow, REST API for the frontend, webhook-style endpoints.

**firehose** — Persistent WebSocket connection to AT Protocol Jetstream. Filters events for followed DIDs, extracts URLs, enqueues jobs.

**worker** — pg-boss job processor. Fetches articles, runs detection pipeline, stores results, triggers bot replies.

### External Services

| Service | Purpose |
|---|---|
| Bluesky / AT Protocol | OAuth, Jetstream, posting, DMs |
| LLM Provider (abstracted) | Q&A answering for bot |
| PostgreSQL | All persistent state, job queue |

### No Redis. No Docker. No message broker.

pg-boss uses PostgreSQL as the job queue. PM2 manages process lifecycle. Caddy handles TLS.

---

## 3. Repository Structure

```
open-news/
├── src/
│   ├── web/
│   │   ├── index.ts           # Hono app entry, route registration
│   │   ├── routes/
│   │   │   ├── auth.ts        # OAuth endpoints
│   │   │   ├── articles.ts    # Article feed endpoints
│   │   │   ├── sources.ts     # Source management
│   │   │   └── health.ts      # Health check
│   │   └── middleware/
│   │       ├── session.ts     # Session validation
│   │       └── rateLimit.ts   # Simple IP rate limiting
│   ├── firehose/
│   │   └── index.ts           # Jetstream consumer entry
│   ├── worker/
│   │   └── index.ts           # pg-boss worker entry
│   ├── jobs/
│   │   ├── fetchArticle.ts    # Fetch + detect + store article
│   │   ├── syncFollows.ts     # Import follow graph for new user
│   │   ├── botReply.ts        # Compose + send bot reply
│   │   └── botPost.ts         # Post new article discovery
│   ├── services/
│   │   ├── atproto.ts         # AT Protocol client wrapper
│   │   ├── articleDetector.ts # News detection scoring
│   │   ├── articleFetcher.ts  # HTTP fetch + meta extraction
│   │   ├── articleText.ts     # Full text extraction
│   │   ├── llm.ts             # LLM abstraction layer
│   │   └── bot.ts             # Bot reply composition
│   ├── db/
│   │   ├── client.ts          # pg pool singleton
│   │   ├── migrations/        # SQL migration files
│   │   └── queries/           # Typed query functions
│   └── lib/
│       ├── logger.ts          # Structured logging (pino)
│       ├── urls.ts            # URL normalization utilities
│       └── config.ts          # Env var validation (zod)
├── ecosystem.config.js        # PM2 process config
├── Caddyfile                  # Reverse proxy + TLS
├── tsconfig.json
├── package.json
└── .env.example
```

---

## 4. Environment Configuration

All config is validated at startup using Zod. The app will refuse to start if required vars are missing.

```
# .env.example

# Database
DATABASE_URL=postgresql://opennews:password@localhost:5432/opennews

# AT Protocol / Bluesky
BSKY_BOT_DID=did:plc:xxxx           # The @open.news bot account DID
BSKY_BOT_PASSWORD=app-password-here  # App password for bot account
BSKY_OAUTH_CLIENT_ID=https://open.news/oauth/client-metadata.json
BSKY_OAUTH_CLIENT_SECRET=xxx         # If confidential client
ATPROTO_PDS_URL=https://bsky.social  # Override for testing

# Jetstream
JETSTREAM_URL=wss://jetstream2.us-east.bsky.network/subscribe

# LLM (abstracted — configure one)
LLM_PROVIDER=anthropic               # anthropic | openai | ollama
LLM_API_KEY=sk-ant-xxx
LLM_MODEL=claude-3-5-haiku-20241022  # Use a fast/cheap model for bot replies

# Web
PORT=3000
SESSION_SECRET=long-random-string-here
BASE_URL=https://open.news

# Operational
LOG_LEVEL=info
NODE_ENV=production
```

`src/lib/config.ts` uses `zod` to parse `process.env` and export a typed `config` object. Import this instead of `process.env` directly everywhere.

---

## 5. Database Schema & Migrations

### Migration Strategy

Use raw SQL files in `src/db/migrations/` named `001_initial.sql`, `002_add_article_text.sql`, etc. A small migration runner in `src/db/migrate.ts` runs on startup (web process only), applying any unapplied migrations tracked in a `schema_migrations` table.

No ORM. Use `pg` (node-postgres) with typed query wrapper functions in `src/db/queries/`.

---

### Migration 001 — Initial Schema

```sql
-- schema_migrations: tracks applied migrations
CREATE TABLE schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- users: authenticated Bluesky accounts
CREATE TABLE users (
  id              BIGSERIAL PRIMARY KEY,
  did             TEXT NOT NULL UNIQUE,         -- AT Protocol DID, permanent identity
  handle          TEXT NOT NULL,                -- e.g. alice.bsky.social (can change)
  display_name    TEXT,
  avatar_url      TEXT,
  access_jwt      TEXT,                         -- Bluesky OAuth access token (encrypted at rest)
  refresh_jwt     TEXT,                         -- Bluesky OAuth refresh token (encrypted at rest)
  token_expires_at TIMESTAMPTZ,
  follows_synced_at TIMESTAMPTZ,               -- When follow graph was last imported
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- sources: accounts or feeds being monitored
-- In MVP: one source = one Bluesky account being followed
CREATE TABLE sources (
  id            BIGSERIAL PRIMARY KEY,
  type          TEXT NOT NULL DEFAULT 'bluesky', -- 'bluesky' | 'rss' (future)
  did           TEXT,                             -- Bluesky DID (null for RSS sources)
  handle        TEXT,
  display_name  TEXT,
  avatar_url    TEXT,
  feed_url      TEXT,                             -- RSS URL (future)
  last_seen_at  TIMESTAMPTZ,                      -- Most recent activity
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (type, did),
  UNIQUE (type, feed_url)
);

-- user_sources: which users follow which sources
CREATE TABLE user_sources (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id   BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, source_id)
);

-- articles: one row per unique URL (deduplicated)
CREATE TABLE articles (
  id              BIGSERIAL PRIMARY KEY,
  url             TEXT NOT NULL UNIQUE,            -- original URL
  canonical_url   TEXT,                            -- after redirects/canonicalization
  title           TEXT,
  description     TEXT,
  image_url       TEXT,
  author          TEXT,
  published_at    TIMESTAMPTZ,
  site_name       TEXT,
  og_type         TEXT,                            -- og:type value
  jsonld_type     TEXT,                            -- schema.org @type value
  news_score      INTEGER NOT NULL DEFAULT 0,      -- detection score (see §9)
  is_news         BOOLEAN NOT NULL DEFAULT FALSE,  -- score >= threshold
  fetch_status    TEXT NOT NULL DEFAULT 'pending', -- pending | fetched | failed
  fetch_error     TEXT,
  fetched_at      TIMESTAMPTZ,
  -- Full text fields (populated after initial fetch)
  full_text       TEXT,                            -- extracted article body
  text_extracted_at TIMESTAMPTZ,
  word_count      INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX articles_fetch_status_idx ON articles(fetch_status);
CREATE INDEX articles_is_news_idx ON articles(is_news);
CREATE INDEX articles_published_at_idx ON articles(published_at DESC);

-- article_sources: which source(s) shared an article, and when
CREATE TABLE article_sources (
  article_id      BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  source_id       BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  post_uri        TEXT,                -- AT Protocol URI of the sharing post
  post_cid        TEXT,                -- AT Protocol CID (for reposting)
  discovered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (article_id, source_id)
);

-- user_articles: each user's relationship to articles (via their sources)
-- Populated when article is detected from a source the user follows
CREATE TABLE user_articles (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id  BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  seen_at     TIMESTAMPTZ,                         -- null = unread
  saved_at    TIMESTAMPTZ,                         -- null = not saved
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, article_id)
);

CREATE INDEX user_articles_user_id_created_idx ON user_articles(user_id, created_at DESC);

-- conversations: a thread of messages, any origin or visibility
CREATE TABLE conversations (
  id            BIGSERIAL PRIMARY KEY,
  visibility    TEXT NOT NULL DEFAULT 'private', -- 'private' | 'public' | 'group'
  type          TEXT NOT NULL DEFAULT 'web',     -- 'web' | 'bluesky_dm' | 'bluesky_mention'
  external_id   TEXT,                            -- bluesky convo ID or thread URI
  title         TEXT,                            -- auto-summarized from first message
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX conversations_external_id_idx ON conversations(external_id)
  WHERE external_id IS NOT NULL;

-- conversation_participants: who is in each conversation
CREATE TABLE conversation_participants (
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,  -- null = bot
  role            TEXT NOT NULL DEFAULT 'member',                  -- 'member' | 'bot'
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, COALESCE(user_id, 0))
);

-- messages: individual messages within a conversation
-- role mirrors LLM API conventions so history can be passed directly to LLM
CREATE TABLE messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id),  -- null = bot/system message
  role            TEXT NOT NULL,                 -- 'user' | 'assistant' | 'system'

  -- Text content (plain text, may be null if message is purely blocks)
  text            TEXT,

  -- Rich content blocks — ordered array of typed block objects (see §17)
  blocks          JSONB,

  -- Agent metadata
  agent           TEXT,   -- 'rag' | 'preferences' | 'article' | 'discovery'
  intent          TEXT,   -- classified intent string

  -- Provenance and context
  articles_used   BIGINT[],   -- article IDs passed as LLM context
  llm_provider    TEXT,
  external_uri    TEXT,       -- bluesky post URI if message originated from bsky

  -- Streaming state: false while tokens are still arriving
  is_complete     BOOLEAN NOT NULL DEFAULT FALSE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX messages_conversation_id_created_idx
  ON messages(conversation_id, created_at);

-- user_preferences: persistent preferences set via chat commands or settings
CREATE TABLE user_preferences (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,    -- 'mute_domain' | 'mute_source' | 'topic_filter'
  value       TEXT NOT NULL,    -- domain string, DID, or topic keyword
  expires_at  TIMESTAMPTZ,      -- null = permanent
  message_id  BIGINT REFERENCES messages(id),  -- chat message that created this
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, type, value)
);

-- bot_interactions: DEPRECATED — kept as archive, no longer written to
-- Migrate existing rows to conversations/messages via migration script
CREATE TABLE bot_interactions (
  id              BIGSERIAL PRIMARY KEY,
  post_uri        TEXT,
  sender_did      TEXT NOT NULL,
  user_id         BIGINT REFERENCES users(id),
  interaction_type TEXT NOT NULL,
  input_text      TEXT,
  response_text   TEXT,
  llm_provider    TEXT,
  articles_used   BIGINT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- jetstream_cursor: persists resume position for firehose reconnection
CREATE TABLE jetstream_cursor (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton row
  cursor      BIGINT,                     -- Unix microseconds timestamp
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO jetstream_cursor (cursor) VALUES (NULL);
```

---

### Migration 002 — Full Text Search (add after MVP validation)

```sql
-- Add tsvector column for full-text search over article content
ALTER TABLE articles ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(full_text, '')), 'C')
  ) STORED;

CREATE INDEX articles_search_vector_idx ON articles USING GIN(search_vector);
```

This powers the initial LLM context retrieval strategy (PostgreSQL full-text search) without needing a separate vector database for MVP.

---

## 6. API Server

**Framework:** Hono (fast, typed, runs on Node/Bun/edge)  
**Auth:** Session cookie (signed, HttpOnly) containing `userId`  
**Port:** 3000, proxied by Caddy

### 6.1 Bluesky OAuth Flow

Bluesky uses OAuth 2.0 with PKCE and DPoP. The `@atproto/oauth-client-node` package handles the heavy lifting.

**Client metadata** (must be publicly accessible at `BASE_URL/oauth/client-metadata.json`):
```json
{
  "client_id": "https://open.news/oauth/client-metadata.json",
  "client_name": "open.news",
  "client_uri": "https://open.news",
  "redirect_uris": ["https://open.news/oauth/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "scope": "atproto",
  "dpop_bound_access_tokens": true
}
```

**Endpoints:**

`GET /oauth/client-metadata.json` — Serve client metadata (required by AT Protocol)

`GET /oauth/login?handle=alice.bsky.social`
- Resolve handle → DID via `@atproto/api`
- Initiate OAuth flow via `@atproto/oauth-client-node`
- Redirect user to their PDS authorization page

`GET /oauth/callback?code=...&state=...`
- Exchange code for tokens via OAuth client
- Upsert user row (did, handle, tokens)
- Enqueue `syncFollows` job
- Create default private `web` conversation for new users
- Set signed session cookie
- Redirect to `/` (frontend)

`POST /oauth/logout`
- Clear session cookie

### 6.2 Conversation Endpoints

All require valid session.

`GET /api/conversations` — List user's conversations, newest first

```json
{
  "conversations": [
    {
      "id": 1,
      "visibility": "private",
      "type": "web",
      "title": "What's happening with the Fed?",
      "last_message_at": "2024-01-15T10:05:00Z",
      "unread": false
    }
  ]
}
```

`POST /api/conversations` — Start a new conversation

```json
// request
{ "visibility": "private" }
// response
{ "id": 42, "visibility": "private", "type": "web", "created_at": "..." }
```

`GET /api/conversations/:id/messages?before=<cursor>&limit=50` — Load message history, newest-first with cursor pagination. Client reverses order for display.

`POST /api/conversations/:id/messages` — Send a user message. Returns the created user message immediately. Bot response arrives via SSE.

```json
// request
{ "text": "What's the latest on the Fed rate decision?" }
// response — the user message row, created synchronously
{ "id": 99, "role": "user", "text": "...", "is_complete": true, "created_at": "..." }
```

After returning the user message, the server enqueues a `botReply` job. The bot response streams back via SSE (see §6.4).

### 6.3 Article Endpoints

All require valid session.

`GET /api/articles` — Query params: `limit` (default 20, max 100), `before` (cursor), `unread_only` (bool)

`POST /api/articles/:id/seen` — Mark article as seen

`POST /api/articles/:id/save` — Toggle saved status

### 6.4 SSE Stream Endpoint

`GET /api/stream` — Opens a persistent Server-Sent Events connection for the authenticated user. All bot messages for this user are pushed here, regardless of which conversation they belong to.

```
event: message
data: {"conversation_id":1,"message":{"id":100,"role":"assistant","is_complete":false,"text":""}}

event: token
data: {"message_id":100,"token":"The"}

event: token
data: {"message_id":100,"token":" Federal"}

event: blocks
data: {"message_id":100,"blocks":[{"type":"article_list","heading":"Top articles",...}]}

event: done
data: {"message_id":100,"is_complete":true}
```

The client appends tokens to the in-progress message as they arrive. On `done`, it marks the message complete and renders any blocks. On reconnect (e.g. tab regain focus), the client fetches any messages it missed via `GET /api/conversations/:id/messages`.

**SSE implementation in Hono:**
```typescript
app.get('/api/stream', sessionRequired, (c) => {
  return streamSSE(c, async (stream) => {
    // Register this stream for the userId
    sseRegistry.add(userId, stream)
    // Keep alive ping every 30s
    const ping = setInterval(() => stream.writeSSE({ event: 'ping', data: '' }), 30000)
    // Clean up on disconnect
    stream.onAbort(() => {
      clearInterval(ping)
      sseRegistry.remove(userId, stream)
    })
    // Hold open indefinitely
    await new Promise(() => {})
  })
})
```

`sseRegistry` is a simple in-memory `Map<userId, Set<SSEStream>>` — supports multiple tabs per user. Stored in module scope in the web process.

### 6.5 Source Endpoints

`GET /api/sources` — List user's sources

`POST /api/sources/sync` — Manually trigger follow graph re-sync (rate limited: once per hour)

### 6.6 Health

`GET /health` — Returns `{ status: "ok", db: "ok", uptime: 123 }`

---

## 7. Jetstream Consumer

**File:** `src/firehose/index.ts`

Jetstream is Bluesky's filtered WebSocket endpoint. Unlike the full firehose, you subscribe to specific DIDs and receive only their events.

### 7.1 Startup Sequence

1. Load all distinct `sources.did` values from the database
2. Load cursor from `jetstream_cursor` table
3. Connect to Jetstream with `?wantedDids=did1,did2,...&cursor=TIMESTAMP`
4. On each message: process event (see §7.2)
5. Persist cursor to DB every 30 seconds (not every message — reduce write load)
6. On disconnect: wait 5 seconds, reconnect with last known cursor
7. Poll for new sources every 60 seconds → update subscription if DIDs changed

### 7.2 Event Processing

```typescript
// Pseudo-code for event handler
async function handleEvent(event: JetstreamEvent) {
  if (event.kind !== 'commit') return;
  if (event.commit.operation === 'delete') return;
  if (event.commit.collection !== 'app.bsky.feed.post') return;

  const post = event.commit.record;
  const did = event.did;

  // Check for mentions/DMs to bot account
  if (isBotMention(post) || isBotDM(event)) {
    await enqueueJob('botReply', {
      postUri: event.commit.uri,
      postCid: event.commit.cid,
      senderDid: did,
      text: post.text,
      interactionType: isBotDM(event) ? 'dm' : 'mention',
    });
    return;
  }

  // Extract URLs from post
  const urls = extractUrls(post);
  for (const url of urls) {
    const normalized = normalizeUrl(url);
    if (!normalized) continue;

    // Check if already known (deduplication)
    const existing = await db.articles.findByUrl(normalized);
    if (existing) {
      // Still associate with this source if not already done
      await db.articleSources.upsert(existing.id, sourceId, postUri);
      await fanOutToUsers(existing.id, did);
      continue;
    }

    // New URL — enqueue for fetching
    await enqueueJob('fetchArticle', {
      url: normalized,
      sourceDid: did,
      postUri: event.commit.uri,
      postCid: event.commit.cid,
    });
  }
}
```

### 7.3 URL Extraction

Extract URLs from two places in a Bluesky post record:
- `post.facets[]` where `facet.features[].uri` and `$type === 'app.bsky.richtext.facet#link'`
- `post.embed.external.uri` if embed type is `app.bsky.embed.external`

Do NOT use regex on `post.text` — Bluesky facets are authoritative for links.

### 7.4 URL Normalization

Before deduplication, normalize URLs:
- Strip tracking params: `utm_*`, `fbclid`, `ref`, `source`, etc.
- Strip fragment (`#section`)
- Lowercase scheme and host
- Remove trailing slash on bare domain
- Follow redirects during fetch (not at this stage) — canonical URL stored separately

Use the `normalize-url` npm package.

### 7.5 Cursor Persistence

```sql
UPDATE jetstream_cursor SET cursor = $1, updated_at = NOW() WHERE id = 1;
```

On reconnect after crash, Jetstream will replay events from the cursor. This ensures no articles are missed. Cursor is a Unix microsecond timestamp from the event's `time_us` field.

---

## 8. Job Queue & Workers

**Library:** `pg-boss` — PostgreSQL-backed job queue, no Redis required.

### 8.1 Job Definitions

| Job Name | Enqueued By | Worker |
|---|---|---|
| `fetchArticle` | Jetstream consumer | Fetch, detect, store article |
| `syncFollows` | OAuth callback, manual API | Import follow graph |
| `botReply` | Jetstream consumer | Compose + send bot response |
| `botPost` | fetchArticle worker (on new news) | Post discovery to Bluesky |

### 8.2 pg-boss Configuration

```typescript
const boss = new PgBoss({
  connectionString: config.DATABASE_URL,
  retryLimit: 3,
  retryDelay: 30,          // seconds between retries
  expireInHours: 24,
  deleteAfterDays: 7,      // keep job history for debugging
  monitorStateIntervalSeconds: 30,
});
```

### 8.3 Concurrency

| Job | Concurrency | Notes |
|---|---|---|
| `fetchArticle` | 5 | Limit outbound HTTP |
| `syncFollows` | 2 | API rate limit safe |
| `botReply` | 3 | LLM + Bluesky API |
| `botPost` | 2 | Bluesky API rate limits |

### 8.4 Fan-out Logic

When a `fetchArticle` job completes and `is_news = true`, the worker:
1. Finds all users who follow the source that shared this article
2. Inserts rows into `user_articles` for each (skip if already exists)
3. Enqueues a `botPost` job

```sql
INSERT INTO user_articles (user_id, article_id)
SELECT us.user_id, $1
FROM user_sources us
JOIN sources s ON s.id = us.source_id
WHERE s.did = $2
ON CONFLICT (user_id, article_id) DO NOTHING;
```

---

## 9. Article Detection Pipeline

**File:** `src/services/articleDetector.ts`

### 9.1 Scoring Rules

Each article URL is scored. `is_news = score >= 4`.

| Signal | Score | Notes |
|---|---|---|
| `jsonld @type` contains `NewsArticle` or `Article` | +4 | Strongest signal |
| `og:type = article` | +3 | Strong signal |
| Has `article:published_time` meta tag | +2 | |
| Has `article:author` or `og:author` | +1 | |
| `<title>` or `og:title` present | +1 | |
| URL path contains `/article/`, `/news/`, `/story/` | +1 | |
| Word count >= 300 (requires full text) | +1 | Skip if text not available |
| Known news domain (pre-loaded blocklist inversion) | +2 | Optional enhancement |
| `og:type = website` and no other signals | -2 | Penalize generic pages |

Threshold of 4 chosen conservatively: a page with NewsArticle jsonld alone qualifies. A page with `og:type=article` + published time + author also qualifies. Landing pages and social profiles should not.

### 9.2 Meta Tag Extraction

Fetch the URL with a 10-second timeout and `User-Agent: opennews-bot/1.0 (+https://open.news)`. Parse with `cheerio`:

```typescript
// JSON-LD
$('script[type="application/ld+json"]').each((_, el) => {
  // Parse and check @type
});

// Open Graph
$('meta[property^="og:"]').each(...);
$('meta[name^="article:"]').each(...);
$('meta[name="author"]').each(...);

// Canonical URL
$('link[rel="canonical"]').attr('href');
```

Store the raw extracted fields. Score is computed from them.

### 9.3 Fetch Behavior

- **Timeout:** 10 seconds total
- **Max response size:** 5MB (stream and abort if exceeded)
- **Follow redirects:** Yes, up to 5 hops. Store final URL as `canonical_url`.
- **Failed fetches:** Set `fetch_status = 'failed'`, store error. Do not retry automatically — if a URL is reshared later, a new job will attempt it again.
- **Robots.txt:** Do not check for MVP. Add as future hardening.

---

## 10. Article Text Extraction & LLM Context

This section covers how full article text is extracted and how it is used to answer user questions.

### 10.1 Text Extraction

After saving meta tags, the `fetchArticle` worker also extracts article body text using `@mozilla/readability` (the same library Firefox uses for Reader Mode):

```typescript
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(html, { url });
const reader = new Readability(dom.window.document);
const article = reader.parse();

// article.textContent — clean article body text
// article.length — word count proxy
```

Store `full_text` and `word_count` on the articles row. This runs in the same `fetchArticle` job — one fetch, all data extracted.

**If Readability returns null** (non-article page): set `word_count = 0`, leave `full_text = null`. This is also a signal that the page is probably not an article.

### 10.2 LLM Context Strategy (MVP: PostgreSQL Full-Text Search)

When the bot receives a question, it retrieves relevant articles using PostgreSQL full-text search before calling the LLM.

**For a registered user:**
```sql
SELECT a.title, a.description, a.url, a.published_at,
       ts_rank(a.search_vector, query) AS rank,
       LEFT(a.full_text, 2000) AS text_excerpt
FROM articles a
JOIN user_articles ua ON ua.article_id = a.id
JOIN lateral plainto_tsquery('english', $1) query ON TRUE
WHERE ua.user_id = $2
  AND a.is_news = TRUE
  AND a.search_vector @@ query
ORDER BY rank DESC, a.published_at DESC
LIMIT 5;
```

**For a non-user (popularity-based):**
```sql
SELECT a.title, a.description, a.url, a.published_at,
       COUNT(ua.user_id) AS reader_count,
       LEFT(a.full_text, 2000) AS text_excerpt
FROM articles a
JOIN user_articles ua ON ua.article_id = a.id
WHERE a.is_news = TRUE
  AND a.search_vector @@ plainto_tsquery('english', $1)
GROUP BY a.id
ORDER BY reader_count DESC, a.published_at DESC
LIMIT 5;
```

Retrieved articles are passed to the LLM as context. This is the MVP approach. Future enhancement: replace with pgvector embeddings for semantic search.

### 10.3 Context Window Budget

When building LLM context, cap each article excerpt at 1,500 characters, and pass at most 5 articles. Total article context: ~7,500 characters. Leave room for system prompt + user question + response in a 16K context model.

---

## 11. Agent Architecture & Message Handling

All bot responses — whether triggered from the web chat UI or from Bluesky (DM or mention) — flow through the same agent pipeline. The entry point differs; the routing and execution are identical.

### 11.1 Entry Points

**Web chat** — `POST /api/conversations/:id/messages` creates a user message row and enqueues a `botReply` job with `{ conversationId, messageId, userId }`.

**Bluesky DM** — Jetstream consumer detects a `chat.bsky.convo.*` event directed at the bot DID. Finds or creates a `private/bluesky_dm` conversation for this user (keyed on `external_id = bluesky_convo_id`). Creates a user message row. Enqueues `botReply`.

**Bluesky mention** — Jetstream consumer detects a post mentioning the bot DID or a reply in a thread the bot is part of. Finds or creates a `public/bluesky_mention` conversation (keyed on `external_id = root_post_uri`). Creates a user message row. Enqueues `botReply`.

### 11.2 Intent Router

The first step of every `botReply` job is a fast intent classification. For clearly structured commands, regex handles it with no LLM call. For natural language, a fast/cheap LLM call classifies intent.

```typescript
type Intent =
  | 'news_question'      // "What's happening with the Fed?"
  | 'mute_domain'        // "Don't show me NYT anymore"
  | 'mute_source'        // "Stop following @account"
  | 'topic_filter'       // "Only show me tech news"
  | 'article_explain'    // "Tell me more about this article"
  | 'discovery'          // "What's trending?" / "Find more like this"
  | 'greeting'           // "Hi" / "Hello" — respond briefly, no LLM context needed
  | 'unknown'            // Default → route to RAG agent

// Regex shortcuts (no LLM call needed)
const REGEX_INTENTS: [RegExp, Intent][] = [
  [/don'?t (show|include|use).*(site|domain|source)/i, 'mute_domain'],
  [/mute|block|hide|exclude/i, 'mute_domain'],
  [/only show|filter to|just (show|give)/i, 'topic_filter'],
  [/^h(i|ello|ey)\b/i, 'greeting'],
]
```

### 11.3 The Four Agents

**RAG Agent** (`agent: 'rag'`)

Handles news questions. Retrieves relevant articles via PostgreSQL FTS, builds LLM context, streams response.

Context window construction:
1. System prompt with user handle and preference summary
2. Last 6 messages from this conversation (recency context)
3. Up to 5 relevant articles retrieved by FTS against the user's question (§10.2)
4. User's current `user_preferences` rows summarized as instructions

Returns blocks: `text` + optionally `article_list` + `suggestion` chips.

**Preferences Agent** (`agent: 'preferences'`)

Handles commands that modify user behaviour. No LLM streaming — executes synchronously and returns a confirmation.

```typescript
// mute_domain example
async function handleMuteDomain(userId: number, text: string, messageId: number) {
  const domain = extractDomain(text)  // regex or short LLM call
  await db.userPreferences.upsert({
    userId, type: 'mute_domain', value: domain, messageId
  })
  return [{
    type: 'preference_confirm',
    preference_type: 'mute_domain',
    value: domain,
    message: `Got it — articles from ${domain} won't appear in your feed or be used as context.`
  }]
}
```

Returns blocks: `preference_confirm` only. Fast — no streaming needed, response is instant.

**Article Agent** (`agent: 'article'`)

Handles requests about a specific article — summarize, explain, find similar. Triggered when the message references an article by ID (from a tapped article card) or when intent classification identifies a reference to a recently mentioned article.

Passes the article's `full_text` directly into the LLM context (up to 6,000 characters). Returns `text` + related `article_card` blocks.

**Discovery Agent** (`agent: 'discovery'`)

Handles open-ended discovery — trending, popular, "more like this." Queries `user_articles` by recency and cross-user popularity. Returns `article_list` blocks with a brief text intro.

### 11.4 Streaming Response Flow

```
botReply job starts
  │
  ├─ Classify intent
  ├─ Route to agent
  ├─ Create assistant message row { is_complete: false, text: '' }
  │
  ├─ [Preferences agent] → no streaming
  │     Write preference, build blocks, update message { is_complete: true, blocks }
  │     Push SSE 'message' + 'done' events to user's stream
  │     [Bluesky] send reply post
  │
  └─ [RAG / Article / Discovery agents] → streaming
        Build LLM messages array
        Call llm.stream(messages)
          │
          On each token:
            Append to in-memory buffer
            Push SSE 'token' event { message_id, token }
          │
          On completion:
            Parse any structured blocks from response (see §17.2)
            Update message row { is_complete: true, text, blocks }
            Push SSE 'blocks' + 'done' events
            [Bluesky] send reply post (full text, no streaming)
```

### 11.5 Bluesky Reply Formatting

Bluesky posts are limited to 300 graphemes. For Bluesky-originated conversations the worker formats the completed response for posting:

1. Strip any block data — Bluesky gets plain text only
2. If response fits in 300 graphemes: post as single reply
3. If longer: split into thread "1/N", "2/N" — cap at 3 posts
4. Include article URL on the last post if an article was the primary context

### 11.6 Rate Limiting

- Max 1 bot reply per sender per 5 minutes (keyed in `user_preferences`-adjacent memory map or DB)
- Max 60 Bluesky posts per hour (AT Protocol headroom)
- Non-users: 1 reply per DID per hour

### 11.7 Follow-as-Signup

When any DID follows `@open.news` (Jetstream `app.bsky.graph.follow` targeting bot DID):
1. Resolve handle via AT Protocol
2. Upsert partial user row (`did`, `handle`, no tokens)
3. Create their default `private/web` conversation
4. Send Bluesky DM: "Welcome to open.news! Sign in at open.news with your Bluesky account to get personalized news answers and your full reading history."

---

## 12. LLM Abstraction Layer

**File:** `src/services/llm.ts`

All LLM calls go through a single interface. Swap providers by changing `LLM_PROVIDER` env var.

```typescript
interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface LLMResponse {
  text: string
  inputTokens: number
  outputTokens: number
  provider: string
  model: string
}

interface LLMService {
  // Non-streaming: wait for full response (used by Preferences agent, intent classifier)
  complete(messages: LLMMessage[], options?: { maxTokens?: number }): Promise<LLMResponse>

  // Streaming: async generator yielding tokens as they arrive
  stream(
    messages: LLMMessage[],
    options?: { maxTokens?: number }
  ): AsyncGenerator<{ token: string } | { done: true; usage: { input: number; output: number } }>
}
```

**Implementations:**

`AnthropicLLM` — uses `@anthropic-ai/sdk` with `stream: true`  
`OpenAILLM` — uses `openai` npm package with streaming  
`OllamaLLM` — uses local Ollama HTTP API (no API key, free)

The worker's streaming loop pushes each token to the SSE registry:

```typescript
for await (const chunk of llm.stream(messages)) {
  if ('token' in chunk) {
    buffer += chunk.token
    sseRegistry.push(userId, { event: 'token', data: { message_id: msgId, token: chunk.token } })
  } else {
    // done — save final message, push blocks
  }
}
```

Log token counts to the `messages` table (`llm_provider` field) for cost monitoring.

---

## 13. Deploy Setup

### 13.1 Server Provisioning

**Recommended:** Hetzner CX21 — 2 vCPU, 4GB RAM, 40GB SSD, €3.29/mo  
**OS:** Ubuntu 22.04 LTS

Initial setup:
```bash
# As root
adduser opennews
usermod -aG sudo opennews
# Copy SSH key, disable password auth, configure UFW

# Allow ports
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```

### 13.2 Install Dependencies

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL 16
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres createuser opennews
sudo -u postgres createdb opennews -O opennews
sudo -u postgres psql -c "ALTER USER opennews PASSWORD 'yourpassword';"

# PM2
sudo npm install -g pm2

# Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

### 13.3 Caddyfile

Location: `/etc/caddy/Caddyfile`

```
open.news {
    reverse_proxy localhost:3000
}
```

That's it. Caddy handles HTTPS certificate issuance and renewal automatically.

```bash
sudo systemctl enable caddy
sudo systemctl start caddy
```

### 13.4 PM2 Ecosystem Config

**File:** `ecosystem.config.js` in project root.

```javascript
module.exports = {
  apps: [
    {
      name: 'web',
      script: 'node',
      args: '--import tsx/esm src/web/index.ts',
      cwd: '/home/opennews/open-news',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env_file: '.env',
      error_file: '/var/log/opennews/web-error.log',
      out_file: '/var/log/opennews/web-out.log',
    },
    {
      name: 'firehose',
      script: 'node',
      args: '--import tsx/esm src/firehose/index.ts',
      cwd: '/home/opennews/open-news',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env_file: '.env',
      error_file: '/var/log/opennews/firehose-error.log',
      out_file: '/var/log/opennews/firehose-out.log',
      // Restart with exponential backoff on repeated crashes
      exp_backoff_restart_delay: 100,
    },
    {
      name: 'worker',
      script: 'node',
      args: '--import tsx/esm src/worker/index.ts',
      cwd: '/home/opennews/open-news',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '384M',
      env_file: '.env',
      error_file: '/var/log/opennews/worker-error.log',
      out_file: '/var/log/opennews/worker-out.log',
    },
  ],
};
```

### 13.5 First Deploy

```bash
# As opennews user
git clone https://github.com/your-org/open-news.git ~/open-news
cd ~/open-news
npm install
cp .env.example .env
# Fill in .env values

mkdir -p /var/log/opennews

# Run migrations (web process runs them on startup, or run manually)
node --import tsx/esm src/db/migrate.ts

# Start all processes
pm2 start ecosystem.config.js
pm2 save

# Configure PM2 to start on reboot
pm2 startup
# Run the command it prints
```

### 13.6 Subsequent Deploys

```bash
# One-line deploy script: deploy.sh
#!/bin/bash
set -e
cd ~/open-news
git pull origin main
npm install --production
pm2 reload all --update-env
echo "Deploy complete at $(date)"
```

Run `chmod +x deploy.sh`. Deploy is: `ssh opennews@your-server ./open-news/deploy.sh`

### 13.7 PostgreSQL Backup

Daily backup via cron:
```bash
# crontab -e (as opennews user)
0 3 * * * pg_dump opennews | gzip > ~/backups/opennews-$(date +\%Y\%m\%d).sql.gz
# Keep 30 days
0 4 * * * find ~/backups -name "*.sql.gz" -mtime +30 -delete
```

For production: also push backups to object storage (Hetzner Object Storage or Backblaze B2).

---

## 14. Operational Runbook

### Checking Process Status
```bash
pm2 list                    # All processes and memory
pm2 logs firehose --lines 50  # Recent firehose logs
pm2 monit                   # Live dashboard
```

### Restarting a Process
```bash
pm2 restart firehose
pm2 reload all              # Zero-downtime reload (preferred)
```

### Checking the Job Queue
```sql
-- Pending jobs
SELECT name, count(*) FROM pgboss.job WHERE state = 'created' GROUP BY name;

-- Failed jobs (last 24h)
SELECT name, data, output FROM pgboss.job
WHERE state = 'failed' AND createdon > NOW() - INTERVAL '24 hours';

-- Retry a failed job
UPDATE pgboss.job SET state = 'created', retrycount = 0 WHERE id = 'job-uuid';
```

### Jetstream Reconnection Issues
If the firehose process keeps restarting, check if the cursor is corrupted:
```sql
-- Reset cursor to "start from now"
UPDATE jetstream_cursor SET cursor = NULL;
```
This will miss events during the gap but allows the consumer to reconnect cleanly.

### Article Detection Tuning
```sql
-- Check score distribution
SELECT news_score, count(*) FROM articles GROUP BY news_score ORDER BY news_score;

-- Articles at the threshold boundary
SELECT url, title, news_score, og_type, jsonld_type FROM articles
WHERE news_score BETWEEN 3 AND 5 ORDER BY created_at DESC LIMIT 20;
```

---

## 15. MVP Boundaries & Future Work

### In MVP Scope
- Bluesky OAuth signup
- Jetstream-based follow graph monitoring
- URL deduplication and article fetching
- Meta tag + Readability text extraction
- PostgreSQL full-text search for LLM context
- Bot mention + DM responses
- Follow-as-lightweight-signup
- Bot discovery posts for new articles
- Single-server PM2 + Caddy deploy

### Explicitly Out of MVP Scope
- RSS feed sources
- pgvector / embedding-based semantic search (upgrade path from FTS)
- Read/unread sync across devices
- Push notifications
- Multiple servers / horizontal scaling
- Admin dashboard
- Email notifications
- Webhook integrations

### Natural Upgrade Path

| When | Upgrade |
|---|---|
| FTS quality insufficient | Add `pgvector` + embedding job, swap retrieval in `llm.ts` |
| Single server CPU-bound | Move worker to second server, same DB |
| Need RSS sources | Add `type='rss'` sources, new `rssFeed` job |
| High bot volume | Add Redis for rate limiting state |
| Multi-region needed | Read replicas + Fly.io / Railway migration |

---


## 16. Frontend

### Overview

The primary UI is a **chat interface**. The article feed is secondary, accessible via a nav link. The server-rendered shell uses **Hono JSX** + **Pico CSS** (CDN). The chat panel adds **Alpine.js** (CDN) for SSE connection management, token streaming, and message rendering. No bundler, no build step, no separate process.

### File Structure

```
src/web/views/
├── layout.tsx              # HTML shell, Pico CSS, Alpine.js CDN links, nav
├── login.tsx               # Sign in page
├── chat.tsx                # Chat UI shell (server-rendered, Alpine hydrates)
├── feed.tsx                # Article feed (secondary, linked from nav)
└── components/
    ├── MessageBubble.tsx   # Server-render for history load
    └── ArticleCard.tsx     # Shared article card (feed + chat blocks)
```

### Setup

Enable JSX in `tsconfig.json`:
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  }
}
```

Register JSX renderer middleware:
```typescript
import { jsxRenderer } from 'hono/jsx-renderer'
app.use('*', jsxRenderer())
```

### Layout

```tsx
// src/web/views/layout.tsx
export const Layout = ({ title, user, children }: {
  title?: string
  user?: { handle: string } | null
  children: any
}) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title ? `${title} — open.news` : 'open.news'}</title>
      <link rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" />
      <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js"></script>
      <style>{`
        body { max-width: 860px; margin: 0 auto; padding: 0 1rem; }
        nav { display: flex; justify-content: space-between; align-items: center; padding: 1rem 0; }
        /* Chat layout */
        #chat-messages { min-height: 60vh; max-height: 70vh; overflow-y: auto;
                         display: flex; flex-direction: column; gap: 0.75rem;
                         padding: 1rem 0; }
        .msg-user { align-self: flex-end; background: var(--pico-primary-background);
                    color: var(--pico-primary-inverse); border-radius: 12px;
                    padding: 0.6rem 1rem; max-width: 75%; }
        .msg-assistant { align-self: flex-start; max-width: 85%; }
        .msg-assistant .text { background: var(--pico-card-background-color);
                                border-radius: 12px; padding: 0.6rem 1rem; }
        .msg-streaming::after { content: '▋'; animation: blink 1s step-end infinite; }
        @keyframes blink { 50% { opacity: 0; } }
        /* Article cards in chat */
        .article-card-block { border: 1px solid var(--pico-muted-border-color);
                               border-radius: 8px; padding: 0.75rem; margin: 0.5rem 0;
                               display: flex; gap: 0.75rem; }
        .article-card-block img { width: 80px; height: 56px; object-fit: cover;
                                   border-radius: 4px; flex-shrink: 0; }
        .article-card-block .meta { font-size: 0.8rem; color: var(--pico-muted-color); }
        /* Suggestion chips */
        .suggestions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
        .suggestion-chip { font-size: 0.85rem; padding: 0.3rem 0.75rem;
                            border-radius: 999px; border: 1px solid var(--pico-primary);
                            color: var(--pico-primary); cursor: pointer; background: none; }
        .suggestion-chip:hover { background: var(--pico-primary-background);
                                  color: var(--pico-primary-inverse); }
        /* Preference confirm */
        .pref-confirm { background: var(--pico-ins-color); border-radius: 8px;
                        padding: 0.6rem 1rem; font-size: 0.9rem; }
        /* Chat input */
        #chat-input-row { display: flex; gap: 0.5rem; padding: 1rem 0; position: sticky;
                          bottom: 0; background: var(--pico-background-color); }
        #chat-input-row input { flex: 1; margin: 0; }
        #chat-input-row button { margin: 0; width: auto; }
      `}</style>
    </head>
    <body>
      <main class="container">
        <nav>
          <strong><a href="/" style="text-decoration:none">open.news</a></strong>
          <div style="display:flex;gap:1rem;align-items:center">
            {user && <a href="/feed">Feed</a>}
            {user
              ? <a href="/logout" role="button" class="outline secondary"
                   style="padding:0.3rem 0.75rem;font-size:0.85rem">
                  @{user.handle}
                </a>
              : <a href="/login" role="button">Sign in</a>
            }
          </div>
        </nav>
        {children}
      </main>
    </body>
  </html>
)
```

### Login Page

```tsx
// src/web/views/login.tsx
export const LoginPage = () => (
  <Layout title="Sign in">
    <article style="max-width:420px;margin:4rem auto;text-align:center">
      <hgroup>
        <h1>open.news</h1>
        <p>News from the people you follow on Bluesky.</p>
      </hgroup>
      <form action="/oauth/login" method="GET">
        <input type="text" name="handle" placeholder="your.bsky.social"
               required autocomplete="username" autocapitalize="none" />
        <button type="submit">Sign in with Bluesky</button>
      </form>
      <small>No account? <a href="https://bsky.app" target="_blank">Join Bluesky</a> first.</small>
    </article>
  </Layout>
)
```

### Chat Page

The chat page is a server-rendered shell. Alpine.js hydrates the `x-data="chat()"` component, connects to SSE, and handles all dynamic behaviour. Existing message history is server-rendered into the DOM on load; Alpine takes over from there.

```tsx
// src/web/views/chat.tsx
export const ChatPage = ({ user, conversation, messages }: {
  user: { handle: string }
  conversation: { id: number }
  messages: Message[]
}) => (
  <Layout title="Chat" user={user}>
    <div x-data={`chat(${conversation.id})`} x-init="init()">

      {/* Conversation history — server rendered, Alpine appends new messages */}
      <div id="chat-messages" x-ref="messageList">
        {messages.map(m => <MessageBubble message={m} />)}
        {/* Alpine appends new message divs here */}
        <template x-for="msg in newMessages" x-bind:key="msg.id">
          <div x-bind:class="msg.role === 'user' ? 'msg-user' : 'msg-assistant'">
            <div class="text" x-bind:class="msg.isStreaming ? 'msg-streaming' : ''"
                 x-text="msg.text"></div>
            {/* Rich blocks rendered via Alpine */}
            <template x-if="msg.blocks && msg.blocks.length">
              <div x-html="renderBlocks(msg.blocks)"></div>
            </template>
          </div>
        </template>
      </div>

      {/* Sticky input */}
      <div id="chat-input-row">
        <input type="text" x-model="inputText" placeholder="Ask anything about the news..."
               x-on:keydown.enter="sendMessage()"
               x-bind:disabled="sending" />
        <button x-on:click="sendMessage()" x-bind:disabled="sending || !inputText.trim()">
          Send
        </button>
      </div>

    </div>
  </Layout>
)
```

### Alpine Chat Component

```typescript
// public/chat.js  (served as static file, referenced in layout or chat.tsx)
function chat(conversationId) {
  return {
    inputText: '',
    sending: false,
    newMessages: [],   // messages added after page load
    evtSource: null,

    init() {
      this.connectSSE()
      this.$nextTick(() => this.scrollToBottom())
    },

    connectSSE() {
      this.evtSource = new EventSource('/api/stream')

      this.evtSource.addEventListener('message', (e) => {
        const data = JSON.parse(e.data)
        if (data.conversation_id !== conversationId) return
        // New assistant message starting
        this.newMessages.push({
          id: data.message.id,
          role: 'assistant',
          text: '',
          blocks: [],
          isStreaming: true,
        })
        this.scrollToBottom()
      })

      this.evtSource.addEventListener('token', (e) => {
        const { message_id, token } = JSON.parse(e.data)
        const msg = this.newMessages.find(m => m.id === message_id)
        if (msg) { msg.text += token; this.scrollToBottom() }
      })

      this.evtSource.addEventListener('blocks', (e) => {
        const { message_id, blocks } = JSON.parse(e.data)
        const msg = this.newMessages.find(m => m.id === message_id)
        if (msg) msg.blocks = blocks
      })

      this.evtSource.addEventListener('done', (e) => {
        const { message_id } = JSON.parse(e.data)
        const msg = this.newMessages.find(m => m.id === message_id)
        if (msg) { msg.isStreaming = false; this.sending = false }
      })

      // Reconnect on error (tab sleep, network blip)
      this.evtSource.onerror = () => {
        this.evtSource.close()
        setTimeout(() => this.connectSSE(), 3000)
      }
    },

    async sendMessage() {
      const text = this.inputText.trim()
      if (!text || this.sending) return
      this.sending = true
      this.inputText = ''

      // Optimistic: show user message immediately
      this.newMessages.push({ id: Date.now(), role: 'user', text, blocks: [], isStreaming: false })
      this.scrollToBottom()

      await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      // Bot response arrives via SSE — no further action needed here
    },

    // Render rich blocks as HTML string (used in x-html binding)
    renderBlocks(blocks) {
      return blocks.map(block => {
        if (block.type === 'article_list') {
          return `<div class="article-list">
            ${block.heading ? `<p><strong>${block.heading}</strong></p>` : ''}
            ${block.articles.map(a => this.renderArticleCard(a)).join('')}
          </div>`
        }
        if (block.type === 'article_card') return this.renderArticleCard(block)
        if (block.type === 'preference_confirm') {
          return `<div class="pref-confirm">✓ ${block.message}</div>`
        }
        if (block.type === 'suggestion') {
          return `<div class="suggestions">
            ${block.suggestions.map(s =>
              `<button class="suggestion-chip"
                onclick="document.querySelector('[x-data]').__x.$data.inputText='${s}'"
              >${s}</button>`
            ).join('')}
          </div>`
        }
        return ''
      }).join('')
    },

    renderArticleCard(a) {
      return `<div class="article-card-block">
        ${a.image_url ? `<img src="${a.image_url}" alt="" loading="lazy">` : ''}
        <div>
          <a href="${a.url}" target="_blank" rel="noopener noreferrer">
            <strong>${a.title || a.url}</strong>
          </a>
          ${a.description ? `<p style="margin:0.2rem 0;font-size:0.85rem">${a.description}</p>` : ''}
          <p class="meta">${[a.site_name, a.published_at
            ? new Date(a.published_at).toLocaleDateString() : null
          ].filter(Boolean).join(' · ')}</p>
        </div>
      </div>`
    },

    scrollToBottom() {
      this.$nextTick(() => {
        const el = this.$refs.messageList
        if (el) el.scrollTop = el.scrollHeight
      })
    },
  }
}
```

### Routes

```typescript
// GET / → redirect based on auth state
app.get('/', (c) => {
  const userId = c.get('userId')
  return userId ? c.redirect('/chat') : c.redirect('/login')
})

// GET /login
app.get('/login', (c) => {
  if (c.get('userId')) return c.redirect('/chat')
  return c.html(<LoginPage />)
})

// GET /chat — load or create default private conversation
app.get('/chat', sessionRequired, async (c) => {
  const userId = c.get('userId')
  const user = await getUserById(userId)
  const conversation = await getOrCreateDefaultConversation(userId)
  const messages = await getMessages(conversation.id, { limit: 50 })
  return c.html(<ChatPage user={user} conversation={conversation} messages={messages.reverse()} />)
})

// GET /feed — secondary view
app.get('/feed', sessionRequired, async (c) => {
  const userId = c.get('userId')
  const user = await getUserById(userId)
  const { articles, nextCursor } = await getArticlesForUser(userId, {
    before: c.req.query('before')
  })
  return c.html(<FeedPage articles={articles} user={user} nextCursor={nextCursor} />)
})

// GET /logout
app.get('/logout', (c) => {
  deleteCookie(c, 'session')
  return c.redirect('/login')
})
```

### Static Assets

```typescript
import { serveStatic } from 'hono/node-server'
app.use('/static/*', serveStatic({ root: './public' }))
```

Place `public/chat.js` (the Alpine component above) and reference it in the layout `<head>` for chat pages only. Place `public/favicon.ico` and you're done.

### Page Summary

| Page | Route | JS Required |
|---|---|---|
| Login | `GET /login` | None |
| Chat | `GET /chat` | Alpine.js (CDN) + chat.js |
| Feed | `GET /feed` | None |
| OAuth callback | `GET /oauth/callback` | None |
| Logout | `GET /logout` | None |

---

## 17. Rich Message Blocks & Agent Output Format

### 17.1 Block Type Definitions

Every assistant message has a `blocks` array in addition to its `text` field. Blocks are stored as JSONB in the `messages` table and rendered client-side by Alpine's `renderBlocks()` function.

```typescript
type TextBlock = {
  type: 'text'
  text: string
}

type ArticleCardBlock = {
  type: 'article_card'
  article_id: number
  title: string
  url: string
  description: string | null
  image_url: string | null
  site_name: string | null
  published_at: string | null
}

type ArticleListBlock = {
  type: 'article_list'
  heading: string
  articles: ArticleCardBlock[]
}

type SearchResultBlock = {
  type: 'search_result'
  query: string
  url: string
  title: string
  snippet: string
  source: string
}

type PreferenceConfirmBlock = {
  type: 'preference_confirm'
  preference_type: 'mute_domain' | 'mute_source' | 'topic_filter'
  value: string
  message: string   // Human-readable confirmation sentence
}

type SuggestionBlock = {
  type: 'suggestion'
  suggestions: string[]   // Quick-reply chips, max 4
}

type Block =
  | TextBlock
  | ArticleCardBlock
  | ArticleListBlock
  | SearchResultBlock
  | PreferenceConfirmBlock
  | SuggestionBlock
```

### 17.2 LLM Output Parsing

Streaming agents (RAG, Article, Discovery) receive their LLM output as a token stream. After streaming completes, the full text is parsed for blocks. The LLM is prompted to emit structured blocks using a lightweight XML-like convention that survives streaming without buffering:

**System prompt addition for all streaming agents:**
```
After your text response, you may emit structured content using these tags.
Emit them at the end, after your prose response, never inline.

To show articles from context, emit:
<articles heading="Top articles">1,4,7</articles>
(comma-separated article IDs from the provided context)

To suggest follow-up queries, emit:
<suggestions>Tell me more|Mute this topic|Find related</suggestions>

Do not emit these tags if they would not add value.
```

The post-stream parser extracts these tags, resolves article IDs to full article data from the DB, and constructs the final `blocks` array saved to the message row. The raw tags are stripped from the displayed `text`.

### 17.3 Preference Agent Output

The Preferences agent does not stream. It constructs blocks directly in TypeScript:

```typescript
// Example output for "don't show me nytimes.com"
const blocks: Block[] = [
  {
    type: 'preference_confirm',
    preference_type: 'mute_domain',
    value: 'nytimes.com',
    message: "Got it — articles from nytimes.com won't appear in your feed or be used as context."
  },
  {
    type: 'suggestion',
    suggestions: ['Undo this', 'See my preferences', 'Mute another site']
  }
]
```

### 17.4 Conversation Context Construction

When building the LLM messages array for any agent, assemble in this order:

```typescript
const messages: LLMMessage[] = [
  // 1. System prompt with user context and active preferences
  {
    role: 'system',
    content: buildSystemPrompt(user, userPreferences, retrievedArticles)
  },
  // 2. Recent conversation history (last 6 messages, oldest first)
  ...recentMessages.map(m => ({ role: m.role, content: m.text || '' })),
  // 3. Current user message
  { role: 'user', content: userMessage.text }
]
```

The system prompt template:
```
You are the open.news assistant for @{handle}.
You answer questions about news based on articles their Bluesky network has shared.

Active preferences:
{preferences.map(p => `- Do not include content from ${p.value}`).join('\n')}

Relevant articles from their network:
{articles.map(a => `[${a.id}] "${a.title}" (${a.site_name}, ${a.published_at})
${a.text_excerpt}`).join('\n\n')}

Answer using these articles as context. Cite article titles.
If context is insufficient, say so briefly.
Keep responses conversational. Do not fabricate information.
```

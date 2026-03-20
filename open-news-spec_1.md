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

-- bot_interactions: log of mentions/DMs the bot has processed
CREATE TABLE bot_interactions (
  id              BIGSERIAL PRIMARY KEY,
  post_uri        TEXT,                   -- URI of the mention/DM that triggered this
  sender_did      TEXT NOT NULL,
  user_id         BIGINT REFERENCES users(id),  -- null if non-user
  interaction_type TEXT NOT NULL,         -- 'mention' | 'dm'
  input_text      TEXT,
  response_text   TEXT,
  llm_provider    TEXT,
  articles_used   BIGINT[],               -- article IDs used as context
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
- Set signed session cookie
- Redirect to `/` (frontend)

`POST /oauth/logout`
- Clear session cookie

### 6.2 Article Endpoints

All require valid session.

`GET /api/articles`

Query params: `limit` (default 20, max 100), `before` (cursor, ISO timestamp), `unread_only` (bool)

Returns user's articles ordered by `user_articles.created_at DESC`, joined with article data.

```json
{
  "articles": [
    {
      "id": 123,
      "url": "https://example.com/article",
      "title": "Article Title",
      "description": "...",
      "image_url": "...",
      "author": "Jane Smith",
      "published_at": "2024-01-15T10:00:00Z",
      "site_name": "Example News",
      "sources": [{ "handle": "alice.bsky.social", "display_name": "Alice" }],
      "seen_at": null,
      "created_at": "2024-01-15T10:05:00Z"
    }
  ],
  "next_cursor": "2024-01-15T10:05:00Z"
}
```

`POST /api/articles/:id/seen` — Mark article as seen

`POST /api/articles/:id/save` — Toggle saved status

### 6.3 Source Endpoints

`GET /api/sources` — List user's sources (their followed accounts being monitored)

`POST /api/sources/sync` — Manually trigger follow graph re-sync (rate limited: once per hour)

### 6.4 Health

`GET /health` — Returns `{ status: "ok", db: "ok", uptime: 123 }`. Used by PM2 and monitoring.

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

## 11. Bot: Mention & DM Handler

**File:** `src/jobs/botReply.ts`

### 11.1 Trigger Detection (in Jetstream consumer)

**Mention:** Any post where `post.facets` contains a mention of `BSKY_BOT_DID`, or `post.reply.parent.author.did === BSKY_BOT_DID`.

**DM:** Events in `chat.bsky.convo.*` namespace directed to the bot DID. Use `@atproto/api`'s chat methods to read and reply.

### 11.2 Reply Flow

```
Receive trigger
  │
  ├─ Look up sender DID in users table
  │     ├─ Found → is_user = true, load user_id
  │     └─ Not found → is_user = false
  │
  ├─ Extract question text (strip @mention handle)
  │
  ├─ Retrieve context articles (§10.2)
  │     ├─ is_user: personalized search over user's articles
  │     └─ not user: popularity-based search
  │
  ├─ Call LLM (§12) with:
  │     - System prompt (see below)
  │     - Context articles
  │     - User's question
  │
  ├─ Post reply via Bluesky API
  │     ├─ mention: reply to the post
  │     └─ dm: send in the same conversation thread
  │
  └─ Log to bot_interactions table
```

### 11.3 System Prompt

```
You are the open.news assistant. You answer questions about news based on
articles the user's network has shared on Bluesky.

{IF USER}
The user @{handle} has {N} articles in their reading history. Here are the
most relevant ones for their question:

{ARTICLES}

Answer their question using these articles as context. Be specific and cite
article titles. If you don't have enough context to answer well, say so
briefly and suggest they check their feed.
{/IF USER}

{IF NON-USER}
This person isn't a registered open.news user yet. Here are the most-read
articles on this topic across the open.news network:

{ARTICLES}

Answer helpfully, note this is based on network-wide popularity, and mention
they can get personalized answers by signing up at open.news.
{/IF NON-USER}

Keep replies concise — Bluesky posts have a 300 grapheme limit. If needed,
reply in a thread. Do not make up information not present in the articles.
```

### 11.4 Reply Length Management

Bluesky posts are limited to 300 graphemes. The worker must:
1. Attempt to fit the answer in one post
2. If too long, split into a numbered thread: "1/3", "2/3", "3/3"
3. Cap at 3 posts in a thread for MVP

### 11.5 Rate Limiting

- Max 1 reply per sender per 5 minutes (store last reply time in memory or DB)
- Max 60 bot posts per hour total (Bluesky rate limit headroom)
- Non-users get a lower limit: 1 reply per sender per hour

### 11.6 Follow-as-Signup

When any DID follows `@open.news` (detected via Jetstream `app.bsky.graph.follow` event targeting bot DID):
1. Look up their handle via `resolveHandle`
2. If not already a user: create a partial user row (`did`, `handle`, no tokens)
3. Reply with a DM: "Welcome! You'll start getting personalized answers when you fully sign in at open.news — it takes 10 seconds with your Bluesky account."

---

## 12. LLM Abstraction Layer

**File:** `src/services/llm.ts`

All LLM calls go through a single interface. Swap providers by changing `LLM_PROVIDER` env var.

```typescript
interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
}

interface LLMService {
  complete(messages: LLMMessage[], options?: { maxTokens?: number }): Promise<LLMResponse>;
}
```

**Implementations:**

`AnthropicLLM` — uses `@anthropic-ai/sdk`  
`OpenAILLM` — uses `openai` npm package  
`OllamaLLM` — uses local Ollama HTTP API (no API key needed)

Factory function reads `LLM_PROVIDER` from config and returns the correct implementation. The bot never knows which provider it's using.

Log all LLM calls with token counts to `bot_interactions` for cost monitoring.

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

The MVP frontend is minimal: a login page and an article feed. It is server-rendered via **Hono's built-in JSX renderer** and styled with **Pico CSS** (CDN, no build step). No bundler, no framework, no separate process. Templates are TypeScript files that live alongside the web server and deploy with it.

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

Register the JSX renderer middleware in the Hono app:

```typescript
import { jsxRenderer } from 'hono/jsx-renderer'

app.use('*', jsxRenderer())
```

### File Structure

```
src/web/views/
├── layout.tsx          # Shared HTML shell, Pico CSS link, nav
├── login.tsx           # Sign in page
├── feed.tsx            # Article feed page
└── components/
    └── ArticleCard.tsx # Single article row
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
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
      />
      <style>{`
        body { max-width: 860px; margin: 0 auto; }
        nav { display: flex; justify-content: space-between; align-items: center; }
        .article-card { border-bottom: 1px solid var(--pico-muted-border-color); padding: 1rem 0; }
        .article-card:last-child { border-bottom: none; }
        .article-meta { font-size: 0.85rem; color: var(--pico-muted-color); margin: 0.25rem 0 0; }
        .article-image { float: right; margin-left: 1rem; width: 100px; height: 70px; object-fit: cover; border-radius: 4px; }
      `}</style>
    </head>
    <body>
      <main class="container">
        <nav>
          <strong><a href="/" style="text-decoration:none">open.news</a></strong>
          {user
            ? <a href="/logout" role="button" class="outline secondary">Sign out @{user.handle}</a>
            : <a href="/login" role="button">Sign in</a>
          }
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
import { Layout } from './layout'

export const LoginPage = () => (
  <Layout title="Sign in">
    <article style="max-width: 420px; margin: 4rem auto; text-align: center;">
      <hgroup>
        <h1>open.news</h1>
        <p>News from the people you follow on Bluesky.</p>
      </hgroup>
      <form action="/oauth/login" method="GET">
        <input
          type="text"
          name="handle"
          placeholder="your.bsky.social"
          required
          autocomplete="username"
          autocapitalize="none"
        />
        <button type="submit">Sign in with Bluesky</button>
      </form>
      <small>
        No account? <a href="https://bsky.app" target="_blank">Join Bluesky</a> first.
      </small>
    </article>
  </Layout>
)
```

The form submits `GET /oauth/login?handle=alice.bsky.social`, which kicks off the OAuth flow (see §6.1). No JavaScript needed.

### Feed Page

```tsx
// src/web/views/feed.tsx
import { Layout } from './layout'
import { ArticleCard } from './components/ArticleCard'

type Article = {
  id: number
  url: string
  title: string
  description: string | null
  image_url: string | null
  author: string | null
  published_at: string | null
  site_name: string | null
  sources: { handle: string; display_name: string | null }[]
  seen_at: string | null
}

export const FeedPage = ({
  articles,
  user,
  nextCursor,
}: {
  articles: Article[]
  user: { handle: string }
  nextCursor: string | null
}) => (
  <Layout title="Feed" user={user}>
    <h2>Your feed</h2>
    {articles.length === 0 && (
      <p>
        No articles yet — your followed accounts haven't shared any news links
        since you signed up. Check back soon.
      </p>
    )}
    <div id="article-list">
      {articles.map(a => <ArticleCard article={a} />)}
    </div>
    {nextCursor && (
      <p style="text-align:center; margin: 2rem 0;">
        <a href={`/feed?before=${nextCursor}`} role="button" class="outline">
          Load more
        </a>
      </p>
    )}
  </Layout>
)
```

Pagination is plain `<a>` links — no JavaScript. "Load more" replaces the page with the next cursor. Simple, fast, works everywhere.

### Article Card Component

```tsx
// src/web/views/components/ArticleCard.tsx
export const ArticleCard = ({ article }: { article: Article }) => {
  const domain = (() => {
    try { return new URL(article.url).hostname.replace('www.', '') }
    catch { return '' }
  })()

  const sharedBy = article.sources
    .slice(0, 2)
    .map(s => s.display_name || `@${s.handle}`)
    .join(', ')
  const overflow = article.sources.length > 2
    ? ` +${article.sources.length - 2} more` : ''

  return (
    <div class="article-card">
      {article.image_url && (
        <img
          class="article-image"
          src={article.image_url}
          alt=""
          loading="lazy"
          width="100"
          height="70"
        />
      )}
      <a href={article.url} target="_blank" rel="noopener noreferrer">
        <strong>{article.title || article.url}</strong>
      </a>
      {article.description && (
        <p style="margin: 0.25rem 0; font-size: 0.9rem;">{article.description}</p>
      )}
      <p class="article-meta">
        {[
          domain,
          article.author,
          article.published_at
            ? new Date(article.published_at).toLocaleDateString()
            : null,
          `shared by ${sharedBy}${overflow}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  )
}
```

### Routes

```typescript
// In src/web/routes/ — add two routes to the Hono app

// GET /login
app.get('/login', (c) => {
  if (c.get('userId')) return c.redirect('/feed')
  return c.html(<LoginPage />)
})

// GET /feed
app.get('/feed', sessionRequired, async (c) => {
  const userId = c.get('userId')
  const before = c.req.query('before')

  const { articles, nextCursor } = await getArticlesForUser(userId, { before })
  const user = await getUserById(userId)

  return c.html(<FeedPage articles={articles} user={user} nextCursor={nextCursor} />)
})

// POST /logout
app.post('/logout', (c) => {
  deleteCookie(c, 'session')
  return c.redirect('/login')
})
```

### Static Assets

Serve a single static directory for any future assets (favicon, etc.):

```typescript
import { serveStatic } from 'hono/node-server'
app.use('/static/*', serveStatic({ root: './public' }))
```

Place a `public/favicon.ico` and you're done. No other static assets needed — Pico CSS loads from CDN.

### What This Gives You

| Page | Route | Notes |
|---|---|---|
| Login | `GET /login` | Handle input → Bluesky OAuth |
| Feed | `GET /feed` | Paginated article list |
| OAuth callback | `GET /oauth/callback` | Handled by auth route (§6.1) |
| Sign out | `POST /logout` | Clears cookie, redirects |

Zero JavaScript shipped to the browser. Zero build step. Zero bundler. The entire frontend is four TSX files that compile alongside your server code and deploy in the same `pm2 reload`.

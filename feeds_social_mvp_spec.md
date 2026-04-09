# feeds.social – MVP Spec

## Product Definition
A feed-first Bluesky client with a multi-column (TweetDeck-style) interface that treats custom feeds as primary.

---

## Core Principles
- Feeds > Home timeline
- Multi-feed consumption by default
- Fast, minimal, and keyboard-friendly
- No RSS, geo, or AI in v1

---

## Features (MVP)

### 1. Multi-Column Layout
- Horizontal scroll layout
- Each column = one feed
- Columns can be:
  - Bluesky Following
  - Bluesky Custom Feed

### 2. Feed Management
- Add feed via search
- Remove feed
- Reorder columns (drag or buttons)
- Rename column (local label only)

### 3. Feed Display
- Reverse chronological posts
- Infinite scroll or pagination
- Basic post UI:
  - avatar
  - handle
  - text
  - embeds (links/images if easy)

### 4. State Persistence
- Save layout (localStorage for MVP)
- Save scroll position per column
- Track “new posts since last visit”

### 5. Auth
- Bluesky login (App Password or OAuth if available)

---

## Non-Goals (Important)
- No RSS feeds
- No geo features
- No feed creation tools
- No ranking algorithms
- No notifications system

---

## UI Sketch

-----------------------------------------------------
| Column 1 | Column 2 | Column 3 | Column 4 |
| Feed A   | Feed B   | Following| Feed C   |
-----------------------------------------------------

- Horizontal scroll
- Each column independently scrollable

---

## Data Model (Simple)

User
- id

FeedColumn
- id
- user_id
- feed_type (following/custom)
- feed_uri
- title
- position

---

## API Layer

Use Bluesky (AT Protocol):
- Fetch feed by URI
- Fetch timeline (following)

Cache responses lightly if needed.

---

## Tech Notes
use same typescript stack as track. app will have its own domain and users will login with bluesky and app will have its own tables in the database.

State:
- localStorage (layout + scroll)

---

## MVP Milestones

1. Auth with Bluesky
2. Render Following feed in single column
3. Add multiple columns
4. Add/remove feeds
5. Persist layout
6. Polish scrolling + performance

---

## Success Criteria

- Users create 3+ columns
- Users rarely switch back to Home
- Users keep app open as dashboard

---

## Future (Not MVP)

- RSS integration
- Geo feeds
- Hybrid feeds (RSS + Bluesky)
- Feed composition
- Map-based UI


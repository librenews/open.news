-- Phase 2: Conversations, messages, and user preferences

-- conversations: a thread of messages, any origin or visibility
CREATE TABLE IF NOT EXISTS conversations (
  id            BIGSERIAL PRIMARY KEY,
  visibility    TEXT NOT NULL DEFAULT 'private',  -- 'private' | 'public' | 'group'
  type          TEXT NOT NULL DEFAULT 'web',      -- 'web' | 'bluesky_dm' | 'bluesky_mention'
  external_id   TEXT,                             -- bluesky convo ID or thread URI
  title         TEXT,                             -- auto-summarized from first message
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversations_external_id_idx
  ON conversations(external_id) WHERE external_id IS NOT NULL;

-- conversation_participants: who is in each conversation
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id) ON DELETE CASCADE,  -- null = bot
  role            TEXT NOT NULL DEFAULT 'member',                   -- 'member' | 'bot'
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_participants_unique_idx
  ON conversation_participants (conversation_id, COALESCE(user_id, 0));

-- messages: individual messages within a conversation
CREATE TABLE IF NOT EXISTS messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         BIGINT REFERENCES users(id),  -- null = bot/system message
  role            TEXT NOT NULL,                 -- 'user' | 'assistant' | 'system'
  text            TEXT,
  blocks          JSONB,                         -- rich content blocks (article_list, suggestions, etc.)
  agent           TEXT,                          -- 'rag' | 'preferences' | 'article' | 'discovery'
  intent          TEXT,                          -- classified intent string
  articles_used   BIGINT[],                      -- article IDs passed as LLM context
  llm_provider    TEXT,
  external_uri    TEXT,                          -- bluesky post URI if message originated from bsky
  is_complete     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_conversation_id_created_idx
  ON messages(conversation_id, created_at);

-- user_preferences: persistent preferences set via chat commands or settings
CREATE TABLE IF NOT EXISTS user_preferences (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                     -- 'mute_domain' | 'mute_source' | 'topic_filter'
  value       TEXT NOT NULL,                     -- domain string, DID, or topic keyword
  expires_at  TIMESTAMPTZ,                       -- null = permanent
  message_id  BIGINT REFERENCES messages(id),    -- chat message that created this
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, type, value)
);

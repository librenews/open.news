-- 062_media_items.sql
-- Core tables for media detection, transcription, and embedding from the AT Protocol firehose.

-- 1. media_items — core table for all detected media
CREATE TABLE IF NOT EXISTS media_items (
  id            SERIAL PRIMARY KEY,
  uri           TEXT NOT NULL UNIQUE,        -- at:// URI of the post containing the video
  did           TEXT NOT NULL,               -- author DID
  rkey          TEXT NOT NULL,               -- record key
  cid           TEXT,                        -- blob CID for native video
  media_type    TEXT NOT NULL,               -- 'video' for now, later 'audio', 'podcast_link' etc
  source_url    TEXT,                        -- CDN URL to the video/audio file
  alt_text      TEXT,                        -- alt text from embed
  aspect_ratio  TEXT,                        -- e.g. '16:9' from embed metadata
  post_text     TEXT,                        -- text of the containing post
  post_langs    TEXT[],                      -- languages from the post
  duration_ms   INTEGER,                     -- duration if known from metadata
  status        TEXT NOT NULL DEFAULT 'pending', -- pending, downloading, processing, done, failed, skipped
  error         TEXT,                        -- error message if failed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  firehose_ts   BIGINT                       -- time_us from jetstream for ordering
);

CREATE INDEX IF NOT EXISTS idx_media_items_did ON media_items(did);
CREATE INDEX IF NOT EXISTS idx_media_items_status ON media_items(status);
CREATE INDEX IF NOT EXISTS idx_media_items_media_type ON media_items(media_type);
CREATE INDEX IF NOT EXISTS idx_media_items_created_at ON media_items(created_at);

-- 2. media_transcripts — transcription results from faster-whisper
CREATE TABLE IF NOT EXISTS media_transcripts (
  id            SERIAL PRIMARY KEY,
  media_id      INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  language      TEXT,                        -- detected language
  text          TEXT NOT NULL,               -- full transcript text
  segments      JSONB,                       -- timestamped segments [{start, end, text}]
  model         TEXT,                        -- e.g. 'whisper-large-v3-turbo'
  confidence    REAL,                        -- average confidence score
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(media_id)
);

-- 3. media_embeddings — CLAP audio embeddings
CREATE TABLE IF NOT EXISTS media_embeddings (
  id            SERIAL PRIMARY KEY,
  media_id      INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  embedding     REAL[] NOT NULL,             -- CLAP embedding vector (512-dim)
  model         TEXT,                        -- e.g. 'laion/larger_clap_music_and_speech'
  audio_features JSONB,                      -- {sample_rate, channels, duration_s, rms_energy, ...}
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(media_id)
);

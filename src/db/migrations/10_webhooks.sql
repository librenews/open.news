CREATE TABLE IF NOT EXISTS track_webhooks (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
  user_id BIGINT REFERENCES track_users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  consecutive_failures INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS track_webhook_subs (
  webhook_id BIGINT REFERENCES track_webhooks(id) ON DELETE CASCADE,
  track_id BIGINT REFERENCES tracks(id) ON DELETE CASCADE,
  PRIMARY KEY (webhook_id, track_id)
);

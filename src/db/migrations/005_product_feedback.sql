-- Product feedback collected from user chat interactions
CREATE TABLE IF NOT EXISTS product_feedback (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id  BIGINT REFERENCES messages(id) ON DELETE SET NULL,
  category    TEXT NOT NULL,          -- 'suggestion' | 'bug' | 'question' | 'praise'
  summary     TEXT NOT NULL,          -- LLM-extracted one-liner
  raw_text    TEXT NOT NULL,          -- original user message
  status      TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'reviewed' | 'planned' | 'declined'
  admin_notes TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_feedback_status_idx ON product_feedback(status);
CREATE INDEX IF NOT EXISTS product_feedback_user_id_idx ON product_feedback(user_id);

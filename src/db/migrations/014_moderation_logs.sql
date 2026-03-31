CREATE TABLE IF NOT EXISTS moderation_logs (
    id BIGSERIAL PRIMARY KEY,
    did TEXT NOT NULL,
    uri TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX moderation_logs_uri_idx ON moderation_logs(uri);
CREATE INDEX moderation_logs_reason_created_idx ON moderation_logs(reason, created_at);

-- fat.link reinvention: chat-to-artifact platform
-- Drop old link-collection tables, create new artifact tables

-- Ensure fatlink_users exists (may be missing on some environments)
CREATE TABLE IF NOT EXISTS fatlink_users (
  did TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  display_name TEXT,
  avatar TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Drop old tables
DROP TABLE IF EXISTS fatlink_items CASCADE;
DROP TABLE IF EXISTS fatlink_acl CASCADE;
DROP TABLE IF EXISTS fatlinks CASCADE;

-- Artifacts: AI-generated HTML documents
CREATE TABLE IF NOT EXISTS fatlink_artifacts (
  id         BIGSERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  owner_did  TEXT NOT NULL REFERENCES fatlink_users(did),
  html       TEXT NOT NULL DEFAULT '',
  prompt     TEXT,
  version    INT NOT NULL DEFAULT 1,
  is_public  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fatlink_artifacts_owner ON fatlink_artifacts(owner_did);
CREATE INDEX IF NOT EXISTS idx_fatlink_artifacts_slug ON fatlink_artifacts(slug);

-- Version history for artifacts
CREATE TABLE IF NOT EXISTS fatlink_versions (
  id           BIGSERIAL PRIMARY KEY,
  artifact_id  BIGINT NOT NULL REFERENCES fatlink_artifacts(id) ON DELETE CASCADE,
  version      INT NOT NULL,
  html         TEXT NOT NULL,
  prompt       TEXT,
  author_did   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fatlink_versions_artifact
  ON fatlink_versions(artifact_id, version DESC);

-- Recreate ACL table with new FK
CREATE TABLE IF NOT EXISTS fatlink_acl (
  artifact_id BIGINT NOT NULL REFERENCES fatlink_artifacts(id) ON DELETE CASCADE,
  did         TEXT NOT NULL,
  permission  TEXT NOT NULL DEFAULT 'write',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (artifact_id, did)
);

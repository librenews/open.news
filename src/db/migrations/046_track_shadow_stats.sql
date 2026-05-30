-- Add shadow mode support to tracks for research phase
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS shadow BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS category TEXT;

-- Shadow match stats: lightweight daily counters per track
CREATE TABLE IF NOT EXISTS track_shadow_stats (
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  match_count INTEGER NOT NULL DEFAULT 0,
  unique_authors INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (track_id, date)
);

CREATE INDEX IF NOT EXISTS idx_shadow_stats_date ON track_shadow_stats(date DESC);

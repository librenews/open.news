-- Nearby.at geolocation tables (no PostGIS dependency for Phase 1)

-- Canonical places table with spatial hierarchy
CREATE TABLE IF NOT EXISTS nearby_places (
  place_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  place_type TEXT NOT NULL,  -- 'city' | 'state' | 'country' | 'neighborhood'
  parent_place_id TEXT REFERENCES nearby_places(place_id),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nearby_places_type ON nearby_places (place_type);
CREATE INDEX IF NOT EXISTS idx_nearby_places_parent ON nearby_places (parent_place_id);

-- Domain-to-location mapping for automated geotagging
CREATE TABLE IF NOT EXISTS nearby_domain_locations (
  domain TEXT PRIMARY KEY,
  place_id TEXT NOT NULL REFERENCES nearby_places(place_id),
  confidence NUMERIC NOT NULL DEFAULT 0.95,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Core geotag records
CREATE TABLE IF NOT EXISTS nearby_geotags (
  id SERIAL PRIMARY KEY,
  tagger_did TEXT NOT NULL,
  subject TEXT NOT NULL,               -- DID or AT-URI
  subject_type TEXT NOT NULL,          -- 'account' | 'post' | 'document'
  place_id TEXT NOT NULL REFERENCES nearby_places(place_id),
  confidence NUMERIC NOT NULL,         -- 0.0 to 1.0
  source TEXT NOT NULL,                -- 'domain_lookup' | 'profile_bio' | 'feed_membership' | 'user_submitted'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(subject, place_id, tagger_did)
);

CREATE INDEX IF NOT EXISTS idx_geotags_subject ON nearby_geotags (subject);
CREATE INDEX IF NOT EXISTS idx_geotags_place ON nearby_geotags (place_id);
CREATE INDEX IF NOT EXISTS idx_geotags_tagger ON nearby_geotags (tagger_did);
CREATE INDEX IF NOT EXISTS idx_geotags_type ON nearby_geotags (subject_type);

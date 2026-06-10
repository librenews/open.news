-- Ontology layer: typed events, entity relations, event relations

-- Add event_type to events for structured querying
ALTER TABLE ln_events ADD COLUMN IF NOT EXISTS event_type TEXT;
CREATE INDEX IF NOT EXISTS idx_ln_events_type ON ln_events(event_type);

-- Entity-to-entity relationships (owner→restaurant, member→council, etc.)
CREATE TABLE IF NOT EXISTS ln_entity_relations (
  id              BIGSERIAL PRIMARY KEY,
  from_entity_id  BIGINT NOT NULL REFERENCES ln_entities(id) ON DELETE CASCADE,
  to_entity_id    BIGINT NOT NULL REFERENCES ln_entities(id) ON DELETE CASCADE,
  relation_type   TEXT NOT NULL,    -- owns, member_of, subsidiary_of, located_in, employed_by, founded_by, partner_of
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(from_entity_id, to_entity_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_ln_entity_rel_from ON ln_entity_relations(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_ln_entity_rel_to ON ln_entity_relations(to_entity_id);
CREATE INDEX IF NOT EXISTS idx_ln_entity_rel_type ON ln_entity_relations(relation_type);

-- Event-to-event relationships (zoning vote → construction → opening)
CREATE TABLE IF NOT EXISTS ln_event_relations (
  id              BIGSERIAL PRIMARY KEY,
  from_event_id   BIGINT NOT NULL REFERENCES ln_events(id) ON DELETE CASCADE,
  to_event_id     BIGINT NOT NULL REFERENCES ln_events(id) ON DELETE CASCADE,
  relation_type   TEXT NOT NULL,    -- leads_to, caused_by, related_to, part_of, follow_up
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(from_event_id, to_event_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_ln_event_rel_from ON ln_event_relations(from_event_id);
CREATE INDEX IF NOT EXISTS idx_ln_event_rel_to ON ln_event_relations(to_event_id);

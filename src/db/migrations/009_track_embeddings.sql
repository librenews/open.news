-- Store track query embeddings for semantic matching
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS query_embedding DOUBLE PRECISION[];

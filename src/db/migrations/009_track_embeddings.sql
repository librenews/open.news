-- Store track query embeddings for semantic matching
ALTER TABLE tracks ADD COLUMN query_embedding DOUBLE PRECISION[];

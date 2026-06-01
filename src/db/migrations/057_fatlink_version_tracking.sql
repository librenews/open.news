-- Add model/provider tracking to fatlink versions
ALTER TABLE fatlink_versions ADD COLUMN IF NOT EXISTS llm_provider TEXT;
ALTER TABLE fatlink_versions ADD COLUMN IF NOT EXISTS llm_model TEXT;
ALTER TABLE fatlink_versions ADD COLUMN IF NOT EXISTS input_tokens INT;
ALTER TABLE fatlink_versions ADD COLUMN IF NOT EXISTS output_tokens INT;

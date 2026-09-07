-- Forward migration for installations created before metering provenance and
-- custom attributes. Existing rows receive safe defaults.
ALTER TABLE tracium.spans
    ADD COLUMN IF NOT EXISTS output_tokens_derived UInt8 DEFAULT 0,
    ADD COLUMN IF NOT EXISTS unmetered UInt8 DEFAULT 0,
    ADD COLUMN IF NOT EXISTS attributes Map(String, String) DEFAULT map(),
    ADD INDEX IF NOT EXISTS idx_workspace workspace_id TYPE bloom_filter(0.01) GRANULARITY 4;

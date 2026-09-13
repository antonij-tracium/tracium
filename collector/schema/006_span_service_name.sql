-- Forward migration for installations created before service_name was split out
-- of the workflow name. The workflow name now prefers span-scoped signals
-- (gen_ai.agent.name, traceloop entity/workflow) so a trace made of many sub-spans
-- attributes each span to its real workflow; service_name preserves the
-- always-present resource service.name the query layer falls back to for a trace's
-- in-flight display name. Existing rows receive the safe default (''), so
-- historical traces keep grouping on their stored workflow name and simply gain an
-- empty service_name.
ALTER TABLE tracium.spans
    ADD COLUMN IF NOT EXISTS service_name LowCardinality(String) DEFAULT '';

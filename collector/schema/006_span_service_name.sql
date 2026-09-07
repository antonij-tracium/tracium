-- Forward migration for installations created before service_name was split out
-- of agent_name. agent_name now prefers span-scoped signals (gen_ai.agent.name,
-- traceloop entity/workflow) so a multi-agent trace attributes each span to its
-- real agent; service_name preserves the always-present resource service.name the
-- query layer falls back to for a trace's in-flight display name. Existing rows
-- receive the safe default (''), so historical traces keep grouping on their
-- stored agent_name and simply gain an empty service_name.
ALTER TABLE tracium.spans
    ADD COLUMN IF NOT EXISTS service_name LowCardinality(String) DEFAULT '';

CREATE DATABASE IF NOT EXISTS tracium;
-- Tracium span store.
--
-- One row per OTLP span (source='span') or per token-usage metric point rolled
-- into a span-shaped row (source='metric'). All dashboard reads aggregate this
-- table, so its physical layout is chosen for how the API queries it:
--
--   * ORDER BY (start_time_ms, trace_id) — every dashboard query bounds a time
--     window (last 24h/7d/30d). A time-leading sort key lets ClickHouse skip the
--     granules outside the window, so a query reads ~the rows in its window
--     rather than the whole month partition. trace_id second clusters a trace's
--     spans together within a time slice.
--   * INDEX idx_trace_id — single-trace reads (GetTrace/GetSpans) look up by
--     trace_id with no time bound. Without a skip index that is a full scan, since
--     trace_id is not the leading key. A bloom filter prunes to the few granules
--     that hold the trace.
--     The false-positive rate here is load-bearing, not a tuning detail: it is the
--     ONLY thing bounding a query that has no time bound, so the granules read are
--     ~fp x (whole table). At fp=0.01 a 5-span lookup read 40,960 rows at 5M rows,
--     90,112 at 10M and 124,001 at 15M — linear in table size, which breaks the
--     cardinal rule (cost must track the query window, never total rows stored).
--     At fp=0.001 the same lookup pins to one granule: 8,192 rows flat at 5M/10M/
--     15M, and the index is smaller on disk compressed (1.80 vs 3.60 MiB at 5M),
--     because the sparser filter has more zero runs. Do not raise it back.
--   * INDEX idx_user — the user_id business filter lets user-scoped reads
--     skip granules with no matching client. It keeps fp=0.01 deliberately: unlike
--     trace_id, user_id is never queried on its own — every user predicate is
--     appended to a clause already bounded by start_time_ms, so the time-leading
--     sort key does the pruning and those reads already measure flat as the table
--     grows. user_id is also low-cardinality (a handful of end-client labels),
--     so most granules hold most users and no false-positive rate makes them
--     skippable. Tightening it would cost index bits for no measured gain.
--   * TTL — caps retention so the table does not grow without bound. The 90 below
--     is the default; the migration runner rewrites it from RETENTION_DAYS at
--     apply time (RETENTION_DAYS=0 drops the TTL entirely, keeping data forever —
--     e.g. for annual reporting). To change retention on an already-created table,
--     run: ALTER TABLE tracium.spans MODIFY TTL toDateTime(start_time_ms/1000) +
--     INTERVAL <days> DAY  (or MODIFY TTL ... REMOVE / no expr to clear it).
--
-- Single CREATE statement (the migration runner sends one statement per file).
--
-- !! EXISTING DEPLOYMENTS DO NOT ADOPT INDEX CHANGES !!
-- idx_trace_id changed from bloom_filter(0.01) to bloom_filter(0.001). Because
-- this is CREATE TABLE IF NOT EXISTS, the statement is a silent no-op wherever
-- tracium.spans already exists — the table keeps its old 0.01 index and single-
-- trace reads there stay linear in table size. Only fresh volumes get the fix.
-- To adopt it on a live table, rebuild the index in place:
--   ALTER TABLE tracium.spans DROP INDEX idx_trace_id;
--   ALTER TABLE tracium.spans
--     ADD INDEX idx_trace_id trace_id TYPE bloom_filter(0.001) GRANULARITY 1;
--   ALTER TABLE tracium.spans MATERIALIZE INDEX idx_trace_id;  -- rewrites parts
CREATE TABLE IF NOT EXISTS tracium.spans (
    trace_id          String,
    span_id           String,
    parent_span_id    String,
    name              String,
    start_time_ms     Int64,
    end_time_ms       Int64,
    duration_ms       Int64,
    model             String,
    model_normalized  String,
    input_tokens      Int64,
    output_tokens     Int64,
    cost_usd          Float64,
    user_id         String,
    workspace_id    String,
    finish_reason     String,
    error_type        String,
    error_message     String,
    schema_version    Int32,
    received_at       DateTime DEFAULT now(),
    input             String,
    output            String,
    available_tools   String,
    source            LowCardinality(String) DEFAULT 'span',
    agent_name        LowCardinality(String) DEFAULT '',
    -- Resource-level service.name, kept verbatim ("unknown_service*" stored as '').
    -- agent_name now prefers span-scoped signals (gen_ai.agent.name, traceloop
    -- entity/workflow) so multi-agent traces attribute each span to its real
    -- agent; service_name preserves the always-present resource name the query
    -- layer falls back to for a trace's in-flight display name. Additive column —
    -- per Rule 5 it does not bump schema_version, and existing tables do not adopt
    -- it (CREATE IF NOT EXISTS); add it in place with:
    --   ALTER TABLE tracium.spans ADD COLUMN IF NOT EXISTS
    --     service_name LowCardinality(String) DEFAULT '';
    service_name      LowCardinality(String) DEFAULT '',
    kind              LowCardinality(String) DEFAULT '',
    -- Metering provenance. output_tokens_derived: part of output_tokens was
    -- reconciled from total_tokens rather than reported by the provider (Gemini
    -- thinking tokens). unmetered: the call returned output but carried no usage
    -- at all (a stream without include_usage), so its $0 is unknown, not free.
    -- Additive columns — per Rule 5 an additive change does not bump
    -- schema_version. Existing deployments do not adopt them (see the note
    -- above); add them in place with:
    --   ALTER TABLE tracium.spans ADD COLUMN IF NOT EXISTS
    --     output_tokens_derived UInt8 DEFAULT 0, ADD COLUMN IF NOT EXISTS
    --     unmetered UInt8 DEFAULT 0;
    output_tokens_derived UInt8 DEFAULT 0,
    unmetered             UInt8 DEFAULT 0,
    -- Custom business attributes the instrumentation attached and the operator
    -- allocates by (team, user.id, environment, customer, cost_center, …), stored
    -- as a Map so the query layer can GROUP BY / filter attributes['<key>'] with
    -- no schema change. Additive column — per Rule 5 it does not bump
    -- schema_version, and existing tables do not adopt it (CREATE IF NOT EXISTS);
    -- add it in place with:
    --   ALTER TABLE tracium.spans ADD COLUMN IF NOT EXISTS
    --     attributes Map(String, String) DEFAULT map();
    attributes Map(String, String) DEFAULT map(),
    INDEX idx_trace_id trace_id  TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_user   user_id TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_workspace workspace_id TYPE bloom_filter(0.01) GRANULARITY 4
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(toDateTime(start_time_ms / 1000))
ORDER BY (start_time_ms, trace_id)
TTL toDateTime(start_time_ms / 1000) + INTERVAL 90 DAY;

-- Daily metrics rollup.
--
-- Long-horizon dashboards (90d, 1y, …) cannot afford to scan raw spans: a
-- year-wide query would read every span in the year. This pre-aggregated table
-- collapses spans to one row per (day, user, agent, model), so a long-range
-- query reads ~(days × dimension cardinality) rows instead of N spans — its size
-- tracks cardinality, not span volume. Raw spans keep their short TTL for
-- drill-down; this table is tiny and is retained for years.
--
-- It is keyed by bucket_date — a deterministic per-row value (toDate of the span
-- start), NOT an aggregate — so it time-prunes on the partition/sort key. (A
-- per-trace summary cannot: an aggregate like min(start_time_ms) is rejected in
-- the sort key, so it could not time-prune. That is why the rollup is bucketed.)
--
-- Aggregate columns:
--   * Additive sums (cost, tokens, span_count) use SimpleAggregateFunction — the
--     stored value is the final value; querying just sums across buckets.
--   * runs / error_runs are distinct trace counts and need merge state:
--     uniq(trace_id) and uniqIf(trace_id, errored). uniq is approximate
--     (HyperLogLog, ~1%) — fine for dashboards/trends. Querying uses uniqMerge.
--     uniqIf(trace_id, span_errored) reproduces the product's trace-error rule
--     (a trace errored iff any of its spans errored).
--
-- The companion migration 003 creates the materialized view that fills this.
-- Single CREATE statement (the migration runner sends one statement per file).
CREATE TABLE IF NOT EXISTS tracium.metrics_daily (
    bucket_date    Date,
    user_id      String,
    workspace_id String,
    agent_name     LowCardinality(String),
    model          LowCardinality(String),
    cost           SimpleAggregateFunction(sum, Float64),
    input_tokens   SimpleAggregateFunction(sum, UInt64),
    output_tokens  SimpleAggregateFunction(sum, UInt64),
    span_count     SimpleAggregateFunction(sum, UInt64),
    runs           AggregateFunction(uniq, String),
    error_runs     AggregateFunction(uniqIf, String, UInt8)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(bucket_date)
ORDER BY (bucket_date, user_id, workspace_id, agent_name, model);

-- Materialized view that keeps tracium.metrics_daily current.
--
-- Fires on every insert into tracium.spans, aggregates that block, and writes
-- the partial states into metrics_daily (TO target). AggregatingMergeTree merges
-- the partials per (bucket_date, user_id, agent_name, model) over time.
--
-- source='span' only: aggregate token-usage metric rows (source='metric') carry
-- no trace identity and would distort run counts, so the rollup is span-derived
-- (cost included). model prefers the normalized id; agent_name is the span's
-- collector-derived agent (the resource service.name for a trace's spans).
--
-- Note: a materialized view only captures inserts made AFTER it exists. On a
-- fresh deployment there is no data yet, so nothing is missed. To adopt this on
-- a table that already holds spans, backfill once after creating it:
--   INSERT INTO tracium.metrics_daily
--   SELECT toDate(start_time_ms/1000), user_id, agent_name,
--          if(model_normalized!='', model_normalized, model),
--          sum(cost_usd), sum(input_tokens), sum(output_tokens), count(),
--          uniqState(trace_id),
--          uniqIfState(trace_id, error_type!='' OR error_message!='')
--   FROM tracium.spans WHERE source='span'
--   GROUP BY 1,2,3,4;
--
-- Single CREATE statement (the migration runner sends one statement per file).
CREATE MATERIALIZED VIEW IF NOT EXISTS tracium.metrics_daily_mv
TO tracium.metrics_daily AS
SELECT
    toDate(start_time_ms / 1000)                       AS bucket_date,
    user_id,
    workspace_id,
    agent_name,
    if(model_normalized != '', model_normalized, model) AS model,
    sum(cost_usd)                                      AS cost,
    sum(input_tokens)                                  AS input_tokens,
    sum(output_tokens)                                 AS output_tokens,
    count()                                            AS span_count,
    uniqState(trace_id)                                AS runs,
    uniqIfState(trace_id, error_type != '' OR error_message != '') AS error_runs
FROM tracium.spans
WHERE source = 'span'
GROUP BY bucket_date, user_id, workspace_id, agent_name, model;

INSERT INTO tracium.spans (trace_id, span_id, name, start_time_ms, end_time_ms, workspace_id, user_id, agent_name, model, model_normalized, cost_usd, input_tokens, output_tokens, source)
VALUES ('review-trace', 'review-span', 'review-call', toUnixTimestamp64Milli(now64()), toUnixTimestamp64Milli(now64()) + 100, 'review-workspace', 'review-user', 'review-agent', 'review-model', 'review-model', 1, 100, 20, 'span');
INSERT INTO tracium.spans SELECT * FROM tracium.spans WHERE trace_id = 'review-trace';
SELECT 'raw_after_replay' AS check, count() AS rows, uniqExact(tuple(trace_id, span_id)) AS unique_spans, sum(cost_usd) AS cost, sum(input_tokens) AS input_tokens FROM tracium.spans FORMAT JSONEachRow;
SELECT 'rollup_after_replay' AS check, sum(span_count) AS spans, uniqMerge(runs) AS unique_traces, sum(cost) AS cost, sum(input_tokens) AS input_tokens FROM tracium.metrics_daily FORMAT JSONEachRow;
SELECT 'dedup_default' AS check, name, value FROM system.merge_tree_settings WHERE name = 'non_replicated_deduplication_window' FORMAT JSONEachRow;

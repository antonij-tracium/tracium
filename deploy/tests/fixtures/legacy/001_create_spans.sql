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
    tenant_id         String,
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
    kind              LowCardinality(String) DEFAULT '',
    output_tokens_derived UInt8 DEFAULT 0,
    unmetered             UInt8 DEFAULT 0,
    attributes Map(String, String) DEFAULT map(),
    INDEX idx_trace_id trace_id  TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_tenant   tenant_id TYPE bloom_filter(0.01) GRANULARITY 4
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(toDateTime(start_time_ms / 1000))
ORDER BY (start_time_ms, trace_id)
TTL toDateTime(start_time_ms / 1000) + INTERVAL 90 DAY;

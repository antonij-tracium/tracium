CREATE TABLE IF NOT EXISTS tracium.metrics_daily (
    bucket_date    Date,
    tenant_id      String,
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
ORDER BY (bucket_date, tenant_id, agent_name, model);

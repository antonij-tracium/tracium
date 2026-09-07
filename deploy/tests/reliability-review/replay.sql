INSERT INTO tracium.spans (trace_id, span_id, name, start_time_ms, end_time_ms, workspace_id, user_id, agent_name, model, model_normalized, cost_usd, input_tokens, output_tokens, source)
VALUES ('review-trace', 'review-span', 'review-call', toUnixTimestamp64Milli(now64()), toUnixTimestamp64Milli(now64()) + 100, 'review-workspace', 'review-user', 'review-agent', 'review-model', 'review-model', 1, 100, 20, 'span');
INSERT INTO tracium.spans SELECT * FROM tracium.spans WHERE trace_id = 'review-trace';
SELECT 'raw_after_replay' AS check, count() AS rows, uniqExact(tuple(trace_id, span_id)) AS unique_spans, sum(cost_usd) AS cost, sum(input_tokens) AS input_tokens FROM tracium.spans FORMAT JSONEachRow;
SELECT 'rollup_after_replay' AS check, sum(span_count) AS spans, uniqMerge(runs) AS unique_traces, sum(cost) AS cost, sum(input_tokens) AS input_tokens FROM tracium.metrics_daily FORMAT JSONEachRow;
SELECT 'dedup_default' AS check, name, value FROM system.merge_tree_settings WHERE name = 'non_replicated_deduplication_window' FORMAT JSONEachRow;

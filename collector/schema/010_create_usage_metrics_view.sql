-- Typed read view: token-usage metric rows only.
--
-- The companion to tracium.calls (009). Where calls exposes the real spans, this
-- exposes the source='metric' rows — synthetic, identity-less rows the collector
-- writes from gen_ai.client.token.usage data points (one row per input/output
-- token data point, priced upstream). They carry cost, tokens, model, user, and
-- workspace, but no trace/span/agent identity, so they belong only in cost and
-- token aggregates, never in trace/agent/latency/run math.
--
-- The API reads tracium.usage_metrics only alongside tracium.calls when
-- reconciling cost across the two ingestion sources (each is a lower bound on true
-- spend; the reconciled read takes the per-bucket greatest). No trace-shaped query
-- reads it.
--
-- Like calls this is a plain view: no data copied, no run-time cost beyond the
-- filter, and the same additive-column caveat (recreate if the API must read a
-- newly added column). Single CREATE statement (one statement per file).
CREATE VIEW IF NOT EXISTS tracium.usage_metrics AS
SELECT * FROM tracium.spans WHERE source = 'metric';

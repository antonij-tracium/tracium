package query

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/tracium/api/internal/model"
)

// Ingestion sources stored in tracium.spans.source. Real per-call spans are
// "span"; aggregate rows synthesised from OTLP token-usage metrics are "metric".
const (
	sourceSpan   = "span"
	sourceMetric = "metric"
)

// window builds the time-range WHERE clause (and its args) shared by every
// metrics query. lo/hi are epoch-millis bounds; an empty tenant means no filter.
// source pins the query to one ingestion source so metric-derived aggregate rows
// never mix with per-call spans (e.g. inflating trace counts or latency).
func window(tenant string, lo, hi int64, source string) (string, []any) {
	clause := "start_time_ms >= ? AND start_time_ms < ? AND source = ?"
	args := []any{lo, hi, source}
	if tenant != "" {
		clause += " AND tenant_id = ?"
		args = append(args, tenant)
	}
	return clause, args
}

// costWindow builds the WHERE clause for cost reads, which reconcile both
// ingestion sources instead of pinning one (see costReconcileExpr).
func costWindow(tenant string, lo, hi int64) (string, []any) {
	clause := "start_time_ms >= ? AND start_time_ms < ? AND source IN (?, ?)"
	args := []any{lo, hi, sourceSpan, sourceMetric}
	if tenant != "" {
		clause += " AND tenant_id = ?"
		args = append(args, tenant)
	}
	return clause, args
}

// costReconcileExpr is the per-bucket reconciliation of the two cost sources.
// Spans and metrics meter the same spend, but either side can be incomplete:
// spans may be sampled or lack usage (streamed calls), metrics may cover only
// some services or only part of the window — four stray metric rows in a 30d
// window once made the Cost KPI report 99.8% below reality, because the old
// code switched the whole window to whichever source had any rows at all.
// Each side is a lower bound on the bucket's true spend, so the greater of the
// two is the tightest estimate available without per-call identity (metric
// rows have none), and it can never double-count. Buckets where only one
// source reports resolve to that source, so a deployment without metrics is
// bitwise-identical to the pre-metrics span sum.
const costReconcileExpr = `greatest(sumIf(cost_usd, source = 'span'), sumIf(cost_usd, source = 'metric'))`

// costTotal sums reconciled cost over [lo, hi), on the same bucket grid the
// cost series uses so the headline KPI always equals the sum of the chart.
// Summing span cost_usd over rows equals summing it per trace then across
// traces, so a flat sum matches the pre-metrics per-trace rollup.
func (r *ClickHouseRepository) costTotal(ctx context.Context, tenant string, lo, hi, bucketMs int64) (float64, error) {
	clause, args := costWindow(tenant, lo, hi)
	var cost float64
	q := fmt.Sprintf(`
SELECT sum(bucket_cost)
FROM (
    SELECT %s AS bucket_cost
    FROM tracium.spans
    WHERE %s
    GROUP BY intDiv(start_time_ms, ?)
)`, costReconcileExpr, clause)
	if err := r.db.QueryRowContext(ctx, q, append(args, bucketMs)...).Scan(&cost); err != nil {
		return 0, fmt.Errorf("clickhouse: cost total: %w", err)
	}
	return sanitize(cost), nil
}

// traceDurationExpr defines a run's end-to-end latency: the span of wall-clock
// time from the first span starting to the last span ending. Both the headline
// LatencyP95 KPI (kpiAggregates) and the latency chart (LatencySeries) build on
// this single definition so the two always measure the same thing.
const traceDurationExpr = `max(end_time_ms) - min(start_time_ms)`

// spanErrored is the single definition of a failed span: either a typed error
// or a bare error message. The frontend marks a span failed on the same OR
// (error_type || error_message), so every trace-level rollup that decides
// whether a trace errored uses this to keep the status pill, the error banner,
// the failed-span counts, and the error-rate/failures metrics all agreeing.
const spanErrored = `(error_type != '' OR error_message != '')`

// kpiAggregates rolls every span in the window up to its trace, then reduces the
// traces to the trace-shaped headline numbers. Cost is computed separately (it
// may come from the metric source), so it is not in this query — only spans
// (source="span") carry trace identity, durations, and errors.
var kpiAggregates = `
SELECT
    toInt64(count())     AS runs,
    quantile(0.95)(dur)  AS p95,
    avg(errored)         AS err_rate
FROM (
    SELECT
        ` + traceDurationExpr + ` AS dur,
        max(` + spanErrored + `)  AS errored
    FROM tracium.spans
    WHERE %s
    GROUP BY trace_id
)`

// kpiRow holds one window's aggregates before they are paired into deltas.
type kpiRow struct {
	cost, p95, errRate float64
	runs               int64
}

// kpiWindow computes one window's headline numbers: runs/latency/errors from
// spans, and cost reconciled across both sources (see costReconcileExpr).
func (r *ClickHouseRepository) kpiWindow(ctx context.Context, f MetricsFilter, lo, hi int64) (kpiRow, error) {
	clause, args := window(f.TenantID, lo, hi, sourceSpan)
	var row kpiRow
	err := r.db.QueryRowContext(ctx, fmt.Sprintf(kpiAggregates, clause), args...).
		Scan(&row.runs, &row.p95, &row.errRate)
	if err != nil {
		return kpiRow{}, fmt.Errorf("clickhouse: kpi window: %w", err)
	}
	// Over an empty window quantile and avg scan as NaN; coerce so deltas and
	// JSON encoding stay well-defined.
	row.p95 = sanitize(row.p95)
	row.errRate = sanitize(row.errRate)

	cost, err := r.costTotal(ctx, f.TenantID, lo, hi, f.Bucket.Milliseconds())
	if err != nil {
		return kpiRow{}, err
	}
	row.cost = cost
	return row, nil
}

// OverviewKPIs computes the four headline KPIs for the current window alongside
// their change versus the equal-length preceding window. Cost reconciles both
// ingestion sources per bucket (costReconcileExpr) on the same grid in both
// sub-windows and in CostSeries, so the delta compares like with like and the
// KPI always equals the sum of the chart.
func (r *ClickHouseRepository) OverviewKPIs(ctx context.Context, f MetricsFilter) (model.KPISet, error) {
	if f.UseRollup() {
		return r.overviewKPIsRollup(ctx, f)
	}
	cur, err := r.kpiWindow(ctx, f, f.Start.UnixMilli(), f.End.UnixMilli())
	if err != nil {
		return model.KPISet{}, err
	}
	prev, err := r.kpiWindow(ctx, f, f.PrevStart.UnixMilli(), f.Start.UnixMilli())
	if err != nil {
		return model.KPISet{}, err
	}
	return model.KPISet{
		Cost:       kpi(cur.cost, prev.cost, true),
		Runs:       kpi(float64(cur.runs), float64(prev.runs), false),
		LatencyP95: kpi(cur.p95, prev.p95, true),
		ErrorRate:  kpi(cur.errRate, prev.errRate, true),
	}, nil
}

// bucketAxis returns the contiguous bucket grid spanning the window: the
// bucket-aligned start of the first slot (base), the bucket width, and the
// number of slots up to (but not including) End. A series scans its real buckets
// into a map keyed by bucket_ms, then walks base, base+bucketMs, … to materialise
// a gap-free axis, zero-filling slots with no data. The window clause pins every
// real bucket onto this same grid, so map lookups line up exactly.
func bucketAxis(f MetricsFilter) (base, bucketMs int64, n int) {
	bucketMs = f.Bucket.Milliseconds()
	base = (f.Start.UnixMilli() / bucketMs) * bucketMs
	n = int((f.End.UnixMilli() - base + bucketMs - 1) / bucketMs)
	if n < 1 {
		n = 1
	}
	return base, bucketMs, n
}

// snapWindow rounds a window's end down to grid (preserving its length) so that
// requests arriving within the same grid interval produce a byte-identical query
// — the precondition for ClickHouse's query cache to hit. Tenant and bucket are
// unchanged. The caller trades up-to-grid staleness for cross-request caching.
func snapWindow(f MetricsFilter, grid time.Duration) MetricsFilter {
	span := f.End.Sub(f.Start)
	f.End = f.End.Truncate(grid)
	f.Start = f.End.Add(-span)
	return f
}

// CostSeries returns total cost per time bucket across the window, zero-filled
// over the full window so quiet buckets read 0 spend rather than being dropped —
// the sparkline and bar chart then show the true shape.
func (r *ClickHouseRepository) CostSeries(ctx context.Context, f MetricsFilter) ([]model.CostPoint, error) {
	if f.UseRollup() {
		return r.costSeriesRollup(ctx, f)
	}
	bucketMs := f.Bucket.Milliseconds()

	// Agent-scoped cost must use per-call spans (the metric source carries no
	// agent identity) and roll up to traces so the agent filter can apply. The
	// unfiltered path keeps the cheaper span-level sum and metric-source choice.
	if f.Agent != "" {
		clause, args := window(f.TenantID, f.Start.UnixMilli(), f.End.UnixMilli(), sourceSpan)
		q := fmt.Sprintf(`
SELECT intDiv(ts, ?) * ? AS bucket_ms, sum(cost) AS value
FROM (
    SELECT
        min(start_time_ms) AS ts,
        sum(cost_usd)      AS cost,
        %s AS name
    FROM tracium.spans
    WHERE %s
    GROUP BY trace_id
)
WHERE name = ?
GROUP BY bucket_ms`, agentExpr, clause)
		qArgs := append([]any{bucketMs, bucketMs}, args...)
		qArgs = append(qArgs, f.Agent)
		points, err := bucketSeries(ctx, r.db, f, q, qArgs, scanCostBucket, costPoint)
		if err != nil {
			return nil, fmt.Errorf("clickhouse: cost series (agent): %w", err)
		}
		return points, nil
	}

	// Reconcile the two cost sources per bucket (see costReconcileExpr) —
	// the same grid and expression as the KPI, so chart and headline agree.
	clause, args := costWindow(f.TenantID, f.Start.UnixMilli(), f.End.UnixMilli())
	q := fmt.Sprintf(`
SELECT intDiv(start_time_ms, ?) * ? AS bucket_ms, %s AS value
FROM tracium.spans
WHERE %s
GROUP BY bucket_ms`, costReconcileExpr, clause)

	points, err := bucketSeries(ctx, r.db, f, q, append([]any{bucketMs, bucketMs}, args...), scanCostBucket, costPoint)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: cost series: %w", err)
	}
	return points, nil
}

// LatencySeries returns p50/p95/p99 of end-to-end run (trace) latency per time
// bucket, in ms. Each trace is first rolled up to its total duration
// (max(end_time_ms) - min(start_time_ms)) and assigned to the bucket of its
// start, then the quantiles run over trace durations — matching the headline
// LatencyP95 KPI (see kpiAggregates) so the chart and KPI measure the same thing.
//
// The series is null-filled over the full window (see bucketAxis): every slot is
// present so the x-axis aligns with the cost chart beside it, but quiet buckets
// carry nil percentiles rather than 0. Latency is undefined when nothing ran, so
// the chart draws a genuine gap instead of a dip to the floor.
func (r *ClickHouseRepository) LatencySeries(ctx context.Context, f MetricsFilter) ([]model.LatencyPoint, error) {
	if f.UseRollup() {
		// Trace-duration percentiles can't be derived from the daily rollup, and
		// scanning a quarter/year of raw spans for them is exactly what we avoid.
		// Return a null-filled axis; the dashboard hides latency for long windows.
		return latencySeriesEmpty(f), nil
	}
	clause, args := window(f.TenantID, f.Start.UnixMilli(), f.End.UnixMilli(), sourceSpan)
	base, bucketMs, n := bucketAxis(f)
	q := fmt.Sprintf(`
SELECT
    bucket_ms,
    quantile(0.5)(dur)  AS p50,
    quantile(0.95)(dur) AS p95,
    quantile(0.99)(dur) AS p99
FROM (
    SELECT
        intDiv(min(start_time_ms), ?) * ? AS bucket_ms,
        `+traceDurationExpr+` AS dur%s
    FROM tracium.spans
    WHERE %s
    GROUP BY trace_id
)%s
GROUP BY bucket_ms`, agentNameCol(f.Agent), clause, agentNameFilter(f.Agent))

	qArgs := append([]any{bucketMs, bucketMs}, args...)
	if f.Agent != "" {
		qArgs = append(qArgs, f.Agent)
	}
	rows, err := r.db.QueryContext(ctx, q, qArgs...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: latency series: %w", err)
	}
	defer rows.Close()

	type quantiles struct{ p50, p95, p99 float64 }
	byBucket := make(map[int64]quantiles)
	for rows.Next() {
		var bm int64
		var q quantiles
		if err := rows.Scan(&bm, &q.p50, &q.p95, &q.p99); err != nil {
			return nil, fmt.Errorf("clickhouse: scan latency point: %w", err)
		}
		byBucket[bm] = q
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	points := make([]model.LatencyPoint, n)
	for i := 0; i < n; i++ {
		bm := base + int64(i)*bucketMs
		points[i] = model.LatencyPoint{BucketMs: bm}
		if q, ok := byBucket[bm]; ok {
			points[i].P50, points[i].P95, points[i].P99 = &q.p50, &q.p95, &q.p99
		}
	}
	return points, nil
}

// ErrorSeries returns failed-vs-total run counts per time bucket across the
// window — the data behind the "Failures by day" strip and the Traces / Failure
// rate sparklines. Runs (traces) are bucketed by when they started; a run counts
// as errored if any of its spans carries an error type. The series is zero-filled
// over the full window so quiet buckets read 0 runs rather than being dropped.
func (r *ClickHouseRepository) ErrorSeries(ctx context.Context, f MetricsFilter) ([]model.ErrorPoint, error) {
	if f.UseRollup() {
		return r.errorSeriesRollup(ctx, f)
	}
	clause, args := window(f.TenantID, f.Start.UnixMilli(), f.End.UnixMilli(), sourceSpan)
	bucketMs := f.Bucket.Milliseconds()
	q := fmt.Sprintf(`
SELECT
    bucket_ms,
    toInt64(countIf(errored)) AS errors,
    toInt64(count())          AS total
FROM (
    SELECT
        intDiv(min(start_time_ms), ?) * ? AS bucket_ms,
        max(`+spanErrored+`)              AS errored%s
    FROM tracium.spans
    WHERE %s
    GROUP BY trace_id
)%s
GROUP BY bucket_ms`, agentNameCol(f.Agent), clause, agentNameFilter(f.Agent))

	qArgs := append([]any{bucketMs, bucketMs}, args...)
	if f.Agent != "" {
		qArgs = append(qArgs, f.Agent)
	}
	points, err := bucketSeries(ctx, r.db, f, q, qArgs, scanErrorBucket, errorPoint)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: error series: %w", err)
	}
	return points, nil
}

// agentExpr derives a trace's agent inside a `GROUP BY trace_id` subquery: the
// collector-supplied agent_name of the earliest span, falling back to that
// span's raw name for rows written before agent_name existed (which read back
// as ”). Grouping on this — rather than the raw span name — keeps every
// auto-instrumented trace from collapsing under a generic operation name like
// "openai.chat".
const agentExpr = `argMin(if(agent_name != '', agent_name, name), start_time_ms)`

// agentNameCol / agentNameFilter add an optional single-agent filter to a series
// query whose inner subquery rolls spans up to traces (GROUP BY trace_id). The
// column derives the trace's agent (agentExpr) on the inner rows; the filter
// keeps only the requested agent on the wrapper. Both are empty when no agent is
// set, so the non-agent series query is byte-identical to before. The filter
// binds one extra arg (the agent name), positioned after the window args.
func agentNameCol(agent string) string {
	if agent == "" {
		return ""
	}
	return ",\n        " + agentExpr + " AS name"
}

func agentNameFilter(agent string) string {
	if agent == "" {
		return ""
	}
	return "\nWHERE name = ?"
}

// TopAgents returns the highest-spending agents in the window. An agent is the
// trace's derived agent (see agentExpr).
func (r *ClickHouseRepository) TopAgents(ctx context.Context, f MetricsFilter, limit int) ([]model.AgentCost, error) {
	if f.UseRollup() {
		return r.topAgentsRollup(ctx, f, limit)
	}
	clause, args := window(f.TenantID, f.Start.UnixMilli(), f.End.UnixMilli(), sourceSpan)
	q := fmt.Sprintf(`
SELECT name, sum(cost) AS cost, toInt64(count()) AS calls
FROM (
    SELECT
        %s AS name,
        sum(cost_usd) AS cost
    FROM tracium.spans
    WHERE %s
    GROUP BY trace_id
)
GROUP BY name
ORDER BY cost DESC
LIMIT ?`, agentExpr, clause)

	rows, err := r.db.QueryContext(ctx, q, append(args, limit)...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: top agents: %w", err)
	}
	defer rows.Close()

	agents := []model.AgentCost{}
	for rows.Next() {
		var a model.AgentCost
		if err := rows.Scan(&a.Name, &a.Cost, &a.Calls); err != nil {
			return nil, fmt.Errorf("clickhouse: scan agent: %w", err)
		}
		agents = append(agents, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Each agent's per-bucket call count, on the shared zero-filled axis.
	bucketMs := f.Bucket.Milliseconds()
	trendQ := fmt.Sprintf(`
SELECT name, bucket_ms, toInt64(count()) AS calls
FROM (
    SELECT
        %s AS name,
        intDiv(min(start_time_ms), ?) * ? AS bucket_ms
    FROM tracium.spans
    WHERE %s
    GROUP BY trace_id
)
GROUP BY name, bucket_ms`, agentExpr, clause)
	if err := r.fillAgentTrends(ctx, f, agents, trendQ, append([]any{bucketMs, bucketMs}, args...)); err != nil {
		return nil, fmt.Errorf("clickhouse: agent trends: %w", err)
	}
	return agents, nil
}

// agentsCacheGrid snaps the window's end to a coarse grid so repeated requests
// for the same range (across users, or one user polling) produce a byte-identical
// query that ClickHouse's query cache can serve, instead of re-scanning the
// window every time. The grid width also bounds how stale the result can be.
const agentsCacheGrid = time.Minute

// ListAgents returns the most active agents in the window for the Agents page:
// per agent its run count, total spend, mean run latency, error rate, last trace,
// and a per-bucket call-count sparkline. An agent is the trace's derived agent
// (see agentExpr).
//
// Two efficiency measures (the page is read often, by many dashboards at once):
//   - Single scan: the per-agent aggregates and the sparkline are computed in one
//     pass. The inner query rolls spans up to traces; the outer reduces traces to
//     agents and folds the per-bucket counts into a map via sumMap, which Go then
//     expands onto the shared zero-filled axis. (TopAgents still uses two scans.)
//   - Cached: the window is snapped to agentsCacheGrid and the read opts into the
//     query cache, so concurrent identical requests collapse to one scan.
func (r *ClickHouseRepository) ListAgents(ctx context.Context, f MetricsFilter, limit int) ([]model.Agent, error) {
	if f.UseRollup() {
		return r.listAgentsRollup(ctx, f, limit)
	}
	cf := snapWindow(f, agentsCacheGrid)
	clause, args := window(cf.TenantID, cf.Start.UnixMilli(), cf.End.UnixMilli(), sourceSpan)
	bucketMs := cf.Bucket.Milliseconds()
	q := fmt.Sprintf(`
SELECT
    name,
    toInt64(count())     AS calls,
    sum(cost)            AS cost,
    avg(dur)             AS avg_latency_ms,
    avg(errored)         AS error_rate,
    argMax(trace_id, ts) AS last_trace_id,
    CAST(sumMap([bucket], [toInt64(1)]), 'Map(Int64, Int64)') AS trend
FROM (
    SELECT
        trace_id,
        %s AS name,
        sum(cost_usd)        AS cost,
        `+traceDurationExpr+` AS dur,
        max(`+spanErrored+`) AS errored,
        min(start_time_ms)   AS ts,
        intDiv(min(start_time_ms), ?) * ? AS bucket
    FROM tracium.spans
    WHERE %s
    GROUP BY trace_id
)
GROUP BY name
ORDER BY calls DESC
LIMIT ?
SETTINGS use_query_cache = 1, query_cache_ttl = 60`, agentExpr, clause)

	qArgs := append([]any{bucketMs, bucketMs}, args...)
	qArgs = append(qArgs, limit)
	rows, err := r.db.QueryContext(ctx, q, qArgs...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: list agents: %w", err)
	}
	defer rows.Close()

	agents := []model.Agent{}
	for rows.Next() {
		var a model.Agent
		var trend map[int64]int64
		if err := rows.Scan(&a.Name, &a.Calls, &a.Cost, &a.AvgLatencyMs, &a.ErrorRate, &a.LastTraceID, &trend); err != nil {
			return nil, fmt.Errorf("clickhouse: scan agent: %w", err)
		}
		a.Cost, a.AvgLatencyMs, a.ErrorRate = sanitize(a.Cost), sanitize(a.AvgLatencyMs), sanitize(a.ErrorRate)
		a.Trend = zeroFillTrend(cf, trend)
		agents = append(agents, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return agents, nil
}

// AgentDetail returns one agent's headline metrics for the detail page (f.Agent
// names it), plus its current tool surface. Span-backed only: there is no
// agent-config store, so runtime params are not served. The window is bounded
// like every other metric; callers keep it off the rollup (the handler rejects
// rollup ranges) because per-agent latency can't come from the daily rollup.
// Returns ErrNotFound when the agent has no runs in the window.
//
// The inner query rolls spans up to traces (cost, duration, errored, tokens,
// model, start) and the outer reduces the agent's traces to the headline
// numbers — the same two-level shape as ListAgents, filtered to one agent.
func (r *ClickHouseRepository) AgentDetail(ctx context.Context, f MetricsFilter) (model.AgentDetail, error) {
	clause, args := window(f.TenantID, f.Start.UnixMilli(), f.End.UnixMilli(), sourceSpan)
	q := fmt.Sprintf(`
SELECT
    toInt64(count())                 AS calls,
    sum(cost)                        AS cost,
    avg(dur)                         AS avg_latency_ms,
    quantile(0.95)(dur)              AS p95_latency_ms,
    avg(errored)                     AS error_rate,
    toInt64(sum(in_tok))             AS input_tokens,
    toInt64(sum(out_tok))            AS output_tokens,
    topKIf(1)(model, model != '')[1] AS model,
    argMax(trace_id, ts)             AS last_trace_id
FROM (
    SELECT
        trace_id,
        %s AS name,
        argMin(%s, start_time_ms) AS model,
        sum(cost_usd)        AS cost,
        `+traceDurationExpr+` AS dur,
        max(`+spanErrored+`) AS errored,
        sum(input_tokens)    AS in_tok,
        sum(output_tokens)   AS out_tok,
        min(start_time_ms)   AS ts
    FROM tracium.spans
    WHERE %s
    GROUP BY trace_id
)
WHERE name = ?`, agentExpr, modelExpr, clause)

	var (
		d         model.AgentDetail
		p95       float64
		modelName string
		lastTrace string
	)
	err := r.db.QueryRowContext(ctx, q, append(args, f.Agent)...).Scan(
		&d.Calls, &d.Cost, &d.AvgLatencyMs, &p95, &d.ErrorRate,
		&d.InputTokens, &d.OutputTokens, &modelName, &lastTrace)
	if err != nil {
		return model.AgentDetail{}, fmt.Errorf("clickhouse: agent detail: %w", err)
	}
	// The outer aggregate always returns one row; an agent with no runs in the
	// window comes back as zero calls, which is a 404, not an empty detail.
	if d.Calls == 0 {
		return model.AgentDetail{}, ErrNotFound
	}

	d.Name = f.Agent
	d.Cost, d.AvgLatencyMs, d.ErrorRate = sanitize(d.Cost), sanitize(d.AvgLatencyMs), sanitize(d.ErrorRate)
	if s := sanitize(p95); s > 0 {
		d.P95LatencyMs = &s
	}
	d.Model = modelName
	d.Provider = providerFromModel(modelName)
	d.LastTraceID = lastTrace

	// The tool surface is the union of available_tools across the agent's most
	// recent run — cheap (one trace, bloom-indexed by trace_id) and representative
	// of the current deployment. Empty when content/tool capture is off.
	if lastTrace != "" {
		spans, err := r.GetSpans(ctx, lastTrace)
		if err != nil {
			return model.AgentDetail{}, fmt.Errorf("clickhouse: agent detail tools: %w", err)
		}
		d.Tools = unionTools(spans)
	}
	return d, nil
}

// providerFromModel infers a model's provider from its id prefix. Best-effort:
// returns "" when unrecognised, and the dashboard then omits the provider row.
func providerFromModel(m string) string {
	switch {
	case strings.HasPrefix(m, "claude"):
		return "anthropic"
	case strings.HasPrefix(m, "gpt"), strings.HasPrefix(m, "o1"), strings.HasPrefix(m, "o3"):
		return "openai"
	case strings.HasPrefix(m, "gemini"):
		return "google"
	default:
		return ""
	}
}

// unionTools collapses available_tools across a trace's spans into one entry per
// tool name, marked used if any span used it and taking the first non-empty
// description. Order follows first appearance so the list is stable.
func unionTools(spans []model.Span) []model.AvailableTool {
	var out []model.AvailableTool
	idx := make(map[string]int)
	for _, s := range spans {
		for _, t := range s.AvailableTools {
			if i, ok := idx[t.Name]; ok {
				if t.Used {
					out[i].Used = true
				}
				if out[i].Description == "" {
					out[i].Description = t.Description
				}
				continue
			}
			idx[t.Name] = len(out)
			out = append(out, t)
		}
	}
	return out
}

// Failures returns the agents with the most errored runs in the window, plus
// the total number of failed runs across all agents.
func (r *ClickHouseRepository) Failures(ctx context.Context, f MetricsFilter, limit int) ([]model.Failure, int64, error) {
	if f.UseRollup() {
		return r.failuresRollup(ctx, f, limit)
	}
	clause, args := window(f.TenantID, f.Start.UnixMilli(), f.End.UnixMilli(), sourceSpan)
	// Per trace: its agent (see agentExpr), whether it errored, and one error
	// type. Grouped by agent we get failed vs total runs and the most common error.
	q := fmt.Sprintf(`
SELECT
    name                                AS agent,
    toInt64(countIf(errored))           AS failed,
    toInt64(count())                    AS runs,
    topKIf(1)(err, errored != 0)[1]     AS top_error
FROM (
    SELECT
        %s AS name,
        max(`+spanErrored+`)                AS errored,
        anyIf(error_type, error_type != '') AS err
    FROM tracium.spans
    WHERE %s
    GROUP BY trace_id
)
GROUP BY agent
HAVING failed > 0
ORDER BY failed DESC
LIMIT ?`, agentExpr, clause)

	rows, err := r.db.QueryContext(ctx, q, append(args, limit)...)
	if err != nil {
		return nil, 0, fmt.Errorf("clickhouse: failures: %w", err)
	}
	defer rows.Close()

	failures := []model.Failure{}
	var total int64
	for rows.Next() {
		var fl model.Failure
		var runs int64
		if err := rows.Scan(&fl.Agent, &fl.Count, &runs, &fl.TopError); err != nil {
			return nil, 0, fmt.Errorf("clickhouse: scan failure: %w", err)
		}
		if runs > 0 {
			fl.Pct = float64(fl.Count) / float64(runs)
		}
		failures = append(failures, fl)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	// LIMIT only caps the listed agents, so total errored runs is a separate count.
	totalQ := fmt.Sprintf(`
SELECT toInt64(count())
FROM (
    SELECT trace_id FROM tracium.spans
    WHERE %s
    GROUP BY trace_id
    HAVING max(`+spanErrored+`) = 1
)`, clause)
	if err := r.db.QueryRowContext(ctx, totalQ, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("clickhouse: failures total: %w", err)
	}
	return failures, total, nil
}

// modelExpr picks a span's model, preferring the normalized id and falling back
// to the raw model for rows written before normalization existed.
const modelExpr = `if(model_normalized != '', model_normalized, model)`

// ModelCosts returns the highest-spending models in the window for the usage
// page's "Where it goes" list. Unlike the trace-rollup metrics, this aggregates
// at the span level: a model is attributed cost and tokens directly from the
// spans that named it, and Calls counts those model invocations. Spans with no
// model (tool/internal spans) carry no model and are excluded.
func (r *ClickHouseRepository) ModelCosts(ctx context.Context, f MetricsFilter, limit int) ([]model.ModelCost, error) {
	if f.UseRollup() {
		return r.modelCostsRollup(ctx, f, limit)
	}
	clause, args := window(f.TenantID, f.Start.UnixMilli(), f.End.UnixMilli(), sourceSpan)
	q := fmt.Sprintf(`
SELECT
    %s                 AS name,
    sum(cost_usd)      AS cost,
    toInt64(count())   AS calls,
    toInt64(sum(input_tokens))  AS input_tokens,
    toInt64(sum(output_tokens)) AS output_tokens
FROM tracium.spans
WHERE %s AND %s != ''
GROUP BY name
ORDER BY cost DESC
LIMIT ?`, modelExpr, clause, modelExpr)

	rows, err := r.db.QueryContext(ctx, q, append(args, limit)...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: model costs: %w", err)
	}
	defer rows.Close()

	models := []model.ModelCost{}
	for rows.Next() {
		var m model.ModelCost
		if err := rows.Scan(&m.Name, &m.Cost, &m.Calls, &m.InputTokens, &m.OutputTokens); err != nil {
			return nil, fmt.Errorf("clickhouse: scan model cost: %w", err)
		}
		m.Cost = sanitize(m.Cost)
		models = append(models, m)
	}
	return models, rows.Err()
}

// TenantUsage returns the highest-spending tenants in the current window, each
// paired with its spend in the equal-length preceding window so the usage table
// can show per-column change. Current and previous are computed in a single pass
// over [PrevStart, End): the inner query rolls spans up to traces (cost, tenant,
// start time), and the outer query splits the two windows with sumIf/countIf at
// f.Start. Each row's cost-per-bucket Trend is filled separately over the
// current window.
func (r *ClickHouseRepository) TenantUsage(ctx context.Context, f MetricsFilter, limit int) ([]model.TenantUsage, error) {
	if f.UseRollup() {
		return r.tenantUsageRollup(ctx, f, limit)
	}
	cur := f.Start.UnixMilli()
	clause, args := window(f.TenantID, f.PrevStart.UnixMilli(), f.End.UnixMilli(), sourceSpan)
	q := fmt.Sprintf(`
SELECT
    tenant_id,
    sumIf(cost, ts >= ?)          AS cost_cur,
    sumIf(cost, ts <  ?)          AS cost_prev,
    toInt64(countIf(ts >= ?))     AS runs_cur,
    toInt64(countIf(ts <  ?))     AS runs_prev
FROM (
    SELECT
        any(tenant_id)     AS tenant_id,
        sum(cost_usd)      AS cost,
        min(start_time_ms) AS ts
    FROM tracium.spans
    WHERE %s
    GROUP BY trace_id
)
GROUP BY tenant_id
ORDER BY cost_cur DESC
LIMIT ?`, clause)

	qArgs := append([]any{cur, cur, cur, cur}, args...)
	qArgs = append(qArgs, limit)
	rows, err := r.db.QueryContext(ctx, q, qArgs...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: tenant usage: %w", err)
	}
	defer rows.Close()

	tenants := []model.TenantUsage{}
	for rows.Next() {
		var t model.TenantUsage
		if err := rows.Scan(&t.TenantID, &t.Cost, &t.CostPrev, &t.Runs, &t.RunsPrev); err != nil {
			return nil, fmt.Errorf("clickhouse: scan tenant usage: %w", err)
		}
		t.Cost, t.CostPrev = sanitize(t.Cost), sanitize(t.CostPrev)
		tenants = append(tenants, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Each tenant's per-bucket cost over the current window, on the shared axis.
	bucketMs := f.Bucket.Milliseconds()
	trendClause, trendWArgs := window(f.TenantID, f.Start.UnixMilli(), f.End.UnixMilli(), sourceSpan)
	trendQ := fmt.Sprintf(`
SELECT tenant_id, bucket_ms, sum(cost) AS cost
FROM (
    SELECT
        any(tenant_id)                    AS tenant_id,
        intDiv(min(start_time_ms), ?) * ? AS bucket_ms,
        sum(cost_usd)                     AS cost
    FROM tracium.spans
    WHERE %s
    GROUP BY trace_id
)
GROUP BY tenant_id, bucket_ms`, trendClause)
	if err := r.fillTenantTrends(ctx, f, tenants, trendQ, append([]any{bucketMs, bucketMs}, trendWArgs...)); err != nil {
		return nil, fmt.Errorf("clickhouse: tenant trends: %w", err)
	}
	return tenants, nil
}

// AgentUsage returns the highest-spending agents in the current window paired
// with the preceding window (see TenantUsage), plus each agent's most-used
// model. Single pass over [PrevStart, End): the inner query derives a trace's
// agent (see agentExpr) and model and rolls up its cost; the outer query splits
// the windows with sumIf/countIf and takes the modal model with topK.
func (r *ClickHouseRepository) AgentUsage(ctx context.Context, f MetricsFilter, limit int) ([]model.AgentUsage, error) {
	if f.UseRollup() {
		return r.agentUsageRollup(ctx, f, limit)
	}
	cur := f.Start.UnixMilli()
	clause, args := window(f.TenantID, f.PrevStart.UnixMilli(), f.End.UnixMilli(), sourceSpan)
	q := fmt.Sprintf(`
SELECT
    name,
    topKIf(1)(model, model != '')[1] AS model,
    sumIf(cost, ts >= ?)             AS cost_cur,
    sumIf(cost, ts <  ?)             AS cost_prev,
    toInt64(countIf(ts >= ?))        AS runs_cur,
    toInt64(countIf(ts <  ?))        AS runs_prev
FROM (
    SELECT
        %s AS name,
        argMin(%s, start_time_ms) AS model,
        sum(cost_usd)      AS cost,
        min(start_time_ms) AS ts
    FROM tracium.spans
    WHERE %s
    GROUP BY trace_id
)
GROUP BY name
ORDER BY cost_cur DESC
LIMIT ?`, agentExpr, modelExpr, clause)

	qArgs := append([]any{cur, cur, cur, cur}, args...)
	qArgs = append(qArgs, limit)
	rows, err := r.db.QueryContext(ctx, q, qArgs...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: agent usage: %w", err)
	}
	defer rows.Close()

	agents := []model.AgentUsage{}
	for rows.Next() {
		var a model.AgentUsage
		if err := rows.Scan(&a.Name, &a.Model, &a.Cost, &a.CostPrev, &a.Runs, &a.RunsPrev); err != nil {
			return nil, fmt.Errorf("clickhouse: scan agent usage: %w", err)
		}
		a.Cost, a.CostPrev = sanitize(a.Cost), sanitize(a.CostPrev)
		agents = append(agents, a)
	}
	return agents, rows.Err()
}

// kpi pairs a current and previous value into a KPI. higherIsBad flips the
// delta classification for metrics where an increase is undesirable.
func kpi(cur, prev float64, higherIsBad bool) model.KPI {
	k := model.KPI{Value: cur, DeltaType: "neutral"}
	// No data in the previous period: there's no baseline to compare against, so
	// the move isn't good or bad — leave it neutral with a zero delta.
	if prev == 0 {
		return k
	}
	k.Delta = (cur - prev) / prev
	if cur > prev {
		k.DeltaType = boolToDelta(!higherIsBad)
	} else if cur < prev {
		k.DeltaType = boolToDelta(higherIsBad)
	}
	return k
}

func boolToDelta(good bool) string {
	if good {
		return "good"
	}
	return "bad"
}

// sanitize coerces NaN/Inf (e.g. a quantile over an empty set) to 0.
func sanitize(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

// AttributeKeys returns the distinct custom-attribute keys seen in the window,
// so callers can populate an allocation-dimension picker. Bounded by the time
// window (raw spans) and by limit; custom attributes live only on span rows.
func (r *ClickHouseRepository) AttributeKeys(ctx context.Context, f MetricsFilter, limit int) ([]string, error) {
	clause, args := window(f.TenantID, f.Start.UnixMilli(), f.End.UnixMilli(), sourceSpan)
	q := fmt.Sprintf(`
SELECT DISTINCT arrayJoin(mapKeys(attributes)) AS key
FROM tracium.spans
WHERE %s
ORDER BY key
LIMIT ?`, clause)

	rows, err := r.db.QueryContext(ctx, q, append(args, limit)...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: attribute keys: %w", err)
	}
	defer rows.Close()

	keys := []string{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, fmt.Errorf("clickhouse: scan attribute key: %w", err)
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

// UsageByAttribute groups spend/usage by the value of one custom attribute key —
// the allocation primitive that splits AI cost across teams, users, or any
// dimension the instrumentation tags. Rows missing the key are excluded. Custom
// attributes exist only on span rows, so this reads the span source over the
// time window (metric rows carry no custom attributes).
func (r *ClickHouseRepository) UsageByAttribute(ctx context.Context, f MetricsFilter, key string, limit int) ([]model.AttributeUsage, error) {
	clause, args := window(f.TenantID, f.Start.UnixMilli(), f.End.UnixMilli(), sourceSpan)
	q := fmt.Sprintf(`
SELECT
    attributes[?]               AS value,
    sum(cost_usd)               AS cost,
    toInt64(count())            AS calls,
    toInt64(uniq(trace_id))     AS runs,
    toInt64(sum(input_tokens))  AS input_tokens,
    toInt64(sum(output_tokens)) AS output_tokens
FROM tracium.spans
WHERE %s AND attributes[?] != ''
GROUP BY value
ORDER BY cost DESC
LIMIT ?`, clause)

	qArgs := append([]any{key}, args...)
	qArgs = append(qArgs, key, limit)
	rows, err := r.db.QueryContext(ctx, q, qArgs...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: usage by attribute: %w", err)
	}
	defer rows.Close()

	usage := []model.AttributeUsage{}
	for rows.Next() {
		var u model.AttributeUsage
		if err := rows.Scan(&u.Value, &u.Cost, &u.Calls, &u.Runs, &u.InputTokens, &u.OutputTokens); err != nil {
			return nil, fmt.Errorf("clickhouse: scan attribute usage: %w", err)
		}
		u.Cost = sanitize(u.Cost)
		usage = append(usage, u)
	}
	return usage, rows.Err()
}

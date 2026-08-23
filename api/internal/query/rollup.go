package query

import (
	"context"
	"fmt"
	"time"

	"github.com/tracium/api/internal/model"
)

// This file serves the metrics queries from the daily rollup
// (tracium.metrics_daily, see the collector's 002/003 migrations) instead of raw
// spans. The rollup holds one row per (day, tenant, agent, model), so a long
// window reads ~(days × cardinality) rows rather than every span in the window —
// the read cost tracks cardinality, not span volume.
//
// Each MetricsRepository method dispatches here when f.UseRollup() is true (long
// windows). Short windows stay on the raw-span path in metrics.go, which is exact
// and already O(window) fast.
//
// What the rollup can and cannot serve:
//   - cost, tokens, span counts: exact (additive sums).
//   - runs / error runs: distinct trace counts via uniq/uniqIf states, ~1%
//     approximate (HyperLogLog) — fine for dashboards and trend reporting.
//   - latency percentiles: NOT derivable (they need per-trace durations, which a
//     span→day rollup discards). LatencySeries returns a null-filled axis and the
//     LatencyP95 KPI is left neutral for long windows.
//   - agent identity: the span's collector-derived agent_name column, not the
//     per-trace argMin fallback used on the raw path; for the resource
//     service.name (the common case) these agree.

const dateFmt = "2006-01-02"

// rollupWindow builds the bucket_date range clause and args for the rollup. lo/hi
// bound the window; bucket_date is a Date, so they are passed as YYYY-MM-DD.
// hiInclusive includes the hi day (used for the current window so today's partial
// day is counted); the preceding window passes false so the windows never share a
// boundary day.
func rollupWindow(tenant string, lo, hi time.Time, hiInclusive bool) (string, []any) {
	op := "<"
	if hiInclusive {
		op = "<="
	}
	clause := "bucket_date >= ? AND bucket_date " + op + " ?"
	args := []any{lo.Format(dateFmt), hi.Format(dateFmt)}
	if tenant != "" {
		clause += " AND tenant_id = ?"
		args = append(args, tenant)
	}
	return clause, args
}

// bucketMsExpr converts a Date column to the epoch-ms of its UTC midnight, matching
// the grid bucketAxis builds from the window start (both are UTC day-aligned), so
// rollup buckets line up with the zero-fill axis. toInt64(Date) is days-since-epoch.
const bucketMsExpr = "toInt64(bucket_date) * 86400000"

// --- KPIs ---------------------------------------------------------------------

// rollupKPI holds one window's rollup aggregates before they are paired into deltas.
type rollupKPI struct {
	cost          float64
	runs, errRuns int64
}

func rollupErrRate(k rollupKPI) float64 {
	if k.runs == 0 {
		return 0
	}
	return float64(k.errRuns) / float64(k.runs)
}

func (r *ClickHouseRepository) kpiWindowRollup(ctx context.Context, tenant string, lo, hi time.Time, hiInclusive bool) (rollupKPI, error) {
	clause, args := rollupWindow(tenant, lo, hi, hiInclusive)
	var k rollupKPI
	q := fmt.Sprintf(`SELECT sum(cost), toInt64(uniqMerge(runs)), toInt64(uniqIfMerge(error_runs))
FROM tracium.metrics_daily WHERE %s`, clause)
	if err := r.db.QueryRowContext(ctx, q, args...).Scan(&k.cost, &k.runs, &k.errRuns); err != nil {
		return rollupKPI{}, fmt.Errorf("clickhouse: kpi rollup: %w", err)
	}
	k.cost = sanitize(k.cost)
	return k, nil
}

func (r *ClickHouseRepository) overviewKPIsRollup(ctx context.Context, f MetricsFilter) (model.KPISet, error) {
	cur, err := r.kpiWindowRollup(ctx, f.TenantID, f.Start, f.End, true)
	if err != nil {
		return model.KPISet{}, err
	}
	prev, err := r.kpiWindowRollup(ctx, f.TenantID, f.PrevStart, f.Start, false)
	if err != nil {
		return model.KPISet{}, err
	}
	return model.KPISet{
		Cost: kpi(cur.cost, prev.cost, true),
		Runs: kpi(float64(cur.runs), float64(prev.runs), false),
		// Trace-duration p95 is not derivable from a span→day rollup; leave it
		// neutral. The dashboard hides the latency card for long windows.
		LatencyP95: model.KPI{DeltaType: "neutral"},
		ErrorRate:  kpi(rollupErrRate(cur), rollupErrRate(prev), true),
	}, nil
}

// --- Series -------------------------------------------------------------------

func (r *ClickHouseRepository) costSeriesRollup(ctx context.Context, f MetricsFilter) ([]model.CostPoint, error) {
	clause, args := rollupWindow(f.TenantID, f.Start, f.End, true)
	q := fmt.Sprintf(`SELECT %s AS bucket_ms, sum(cost) AS value
FROM tracium.metrics_daily WHERE %s GROUP BY bucket_ms`, bucketMsExpr, clause)

	points, err := bucketSeries(ctx, r.db, f, q, args, scanCostBucket, costPoint)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: cost series rollup: %w", err)
	}
	return points, nil
}

// latencySeriesEmpty returns the null-filled latency axis without querying:
// trace-duration percentiles can't come from the rollup, so long windows draw a
// gap. The axis still spans the window so it lines up with the cost/error charts.
func latencySeriesEmpty(f MetricsFilter) []model.LatencyPoint {
	base, bucketMs, n := bucketAxis(f)
	points := make([]model.LatencyPoint, n)
	for i := 0; i < n; i++ {
		points[i] = model.LatencyPoint{BucketMs: base + int64(i)*bucketMs}
	}
	return points
}

func (r *ClickHouseRepository) errorSeriesRollup(ctx context.Context, f MetricsFilter) ([]model.ErrorPoint, error) {
	clause, args := rollupWindow(f.TenantID, f.Start, f.End, true)
	q := fmt.Sprintf(`SELECT %s AS bucket_ms,
    toInt64(uniqIfMerge(error_runs)) AS errors,
    toInt64(uniqMerge(runs))         AS total
FROM tracium.metrics_daily WHERE %s GROUP BY bucket_ms`, bucketMsExpr, clause)

	points, err := bucketSeries(ctx, r.db, f, q, args, scanErrorBucket, errorPoint)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: error series rollup: %w", err)
	}
	return points, nil
}

// --- Top-N lists --------------------------------------------------------------

func (r *ClickHouseRepository) topAgentsRollup(ctx context.Context, f MetricsFilter, limit int) ([]model.AgentCost, error) {
	clause, args := rollupWindow(f.TenantID, f.Start, f.End, true)
	q := fmt.Sprintf(`SELECT agent_name AS name, sum(cost) AS cost, toInt64(uniqMerge(runs)) AS calls
FROM tracium.metrics_daily WHERE %s GROUP BY name ORDER BY cost DESC LIMIT ?`, clause)

	rows, err := r.db.QueryContext(ctx, q, append(args, limit)...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: top agents rollup: %w", err)
	}
	defer rows.Close()

	agents := []model.AgentCost{}
	for rows.Next() {
		var a model.AgentCost
		if err := rows.Scan(&a.Name, &a.Cost, &a.Calls); err != nil {
			return nil, fmt.Errorf("clickhouse: scan agent: %w", err)
		}
		a.Cost = sanitize(a.Cost)
		agents = append(agents, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	trendQ := fmt.Sprintf(`SELECT agent_name AS name, %s AS bucket_ms, toInt64(uniqMerge(runs)) AS calls
FROM tracium.metrics_daily WHERE %s GROUP BY name, bucket_ms`, bucketMsExpr, clause)
	if err := r.fillAgentTrends(ctx, f, agents, trendQ, args); err != nil {
		return nil, fmt.Errorf("clickhouse: agent trends rollup: %w", err)
	}
	return agents, nil
}

func (r *ClickHouseRepository) listAgentsRollup(ctx context.Context, f MetricsFilter, limit int) ([]model.Agent, error) {
	clause, args := rollupWindow(f.TenantID, f.Start, f.End, true)
	// calls/error runs are uniq-approximate; avg latency is not derivable from a
	// span→day rollup (per-trace durations are discarded), so it is left 0 for
	// long windows — same limitation as LatencyP95. The dashboard shows "—".
	q := fmt.Sprintf(`SELECT agent_name AS name,
    toInt64(uniqMerge(runs))         AS calls,
    sum(cost)                        AS cost,
    toInt64(uniqIfMerge(error_runs)) AS err_runs
FROM tracium.metrics_daily WHERE %s GROUP BY name ORDER BY calls DESC LIMIT ?`, clause)

	rows, err := r.db.QueryContext(ctx, q, append(args, limit)...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: list agents rollup: %w", err)
	}
	defer rows.Close()

	agents := []model.Agent{}
	for rows.Next() {
		var a model.Agent
		var errRuns int64
		if err := rows.Scan(&a.Name, &a.Calls, &a.Cost, &errRuns); err != nil {
			return nil, fmt.Errorf("clickhouse: scan agent: %w", err)
		}
		a.Cost = sanitize(a.Cost)
		if a.Calls > 0 {
			a.ErrorRate = float64(errRuns) / float64(a.Calls)
		}
		agents = append(agents, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	trendQ := fmt.Sprintf(`SELECT agent_name AS name, %s AS bucket_ms, toInt64(uniqMerge(runs)) AS calls
FROM tracium.metrics_daily WHERE %s GROUP BY name, bucket_ms`, bucketMsExpr, clause)
	if err := r.fillAgentRowTrends(ctx, f, agents, trendQ, args); err != nil {
		return nil, fmt.Errorf("clickhouse: agent trends rollup: %w", err)
	}
	return agents, nil
}

func (r *ClickHouseRepository) failuresRollup(ctx context.Context, f MetricsFilter, limit int) ([]model.Failure, int64, error) {
	clause, args := rollupWindow(f.TenantID, f.Start, f.End, true)
	// top_error is not stored in the rollup (no error_type dimension), so it is
	// left empty for long windows.
	q := fmt.Sprintf(`SELECT agent_name AS agent,
    toInt64(uniqIfMerge(error_runs)) AS failed,
    toInt64(uniqMerge(runs))         AS runs
FROM tracium.metrics_daily WHERE %s GROUP BY agent HAVING failed > 0 ORDER BY failed DESC LIMIT ?`, clause)

	rows, err := r.db.QueryContext(ctx, q, append(args, limit)...)
	if err != nil {
		return nil, 0, fmt.Errorf("clickhouse: failures rollup: %w", err)
	}
	defer rows.Close()

	failures := []model.Failure{}
	for rows.Next() {
		var fl model.Failure
		var runs int64
		if err := rows.Scan(&fl.Agent, &fl.Count, &runs); err != nil {
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

	var total int64
	totalQ := fmt.Sprintf(`SELECT toInt64(uniqIfMerge(error_runs)) FROM tracium.metrics_daily WHERE %s`, clause)
	if err := r.db.QueryRowContext(ctx, totalQ, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("clickhouse: failures total rollup: %w", err)
	}
	return failures, total, nil
}

func (r *ClickHouseRepository) modelCostsRollup(ctx context.Context, f MetricsFilter, limit int) ([]model.ModelCost, error) {
	clause, args := rollupWindow(f.TenantID, f.Start, f.End, true)
	// Calls is span-level (sum of span_count), matching the raw model-costs path.
	q := fmt.Sprintf(`SELECT model AS name, sum(cost) AS cost,
    toInt64(sum(span_count))    AS calls,
    toInt64(sum(input_tokens))  AS input_tokens,
    toInt64(sum(output_tokens)) AS output_tokens
FROM tracium.metrics_daily WHERE %s AND model != '' GROUP BY name ORDER BY cost DESC LIMIT ?`, clause)

	rows, err := r.db.QueryContext(ctx, q, append(args, limit)...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: model costs rollup: %w", err)
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

// --- Usage tables (current vs preceding window) -------------------------------

func (r *ClickHouseRepository) tenantUsageRollup(ctx context.Context, f MetricsFilter, limit int) ([]model.TenantUsage, error) {
	// One pass over [PrevStart, End], split at the current window's start day.
	clause, args := rollupWindow(f.TenantID, f.PrevStart, f.End, true)
	curDate := f.Start.Format(dateFmt)
	q := fmt.Sprintf(`SELECT tenant_id,
    sumIf(cost, bucket_date >= ?)                  AS cost_cur,
    sumIf(cost, bucket_date <  ?)                  AS cost_prev,
    toInt64(uniqMergeIf(runs, bucket_date >= ?))   AS runs_cur,
    toInt64(uniqMergeIf(runs, bucket_date <  ?))   AS runs_prev
FROM tracium.metrics_daily WHERE %s GROUP BY tenant_id ORDER BY cost_cur DESC LIMIT ?`, clause)

	qArgs := append([]any{curDate, curDate, curDate, curDate}, args...)
	qArgs = append(qArgs, limit)
	rows, err := r.db.QueryContext(ctx, q, qArgs...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: tenant usage rollup: %w", err)
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

	// Trends span the current window only (the main query spans [PrevStart, End]).
	trendClause, trendArgs := rollupWindow(f.TenantID, f.Start, f.End, true)
	trendQ := fmt.Sprintf(`SELECT tenant_id, %s AS bucket_ms, sum(cost) AS cost
FROM tracium.metrics_daily WHERE %s GROUP BY tenant_id, bucket_ms`, bucketMsExpr, trendClause)
	if err := r.fillTenantTrends(ctx, f, tenants, trendQ, trendArgs); err != nil {
		return nil, fmt.Errorf("clickhouse: tenant trends rollup: %w", err)
	}
	return tenants, nil
}

func (r *ClickHouseRepository) agentUsageRollup(ctx context.Context, f MetricsFilter, limit int) ([]model.AgentUsage, error) {
	// Agent-level cost/runs split (one pass over [PrevStart, End], split at Start).
	clause, args := rollupWindow(f.TenantID, f.PrevStart, f.End, true)
	curDate := f.Start.Format(dateFmt)
	q := fmt.Sprintf(`SELECT agent_name AS name,
    sumIf(cost, bucket_date >= ?)                AS cost_cur,
    sumIf(cost, bucket_date <  ?)                AS cost_prev,
    toInt64(uniqMergeIf(runs, bucket_date >= ?)) AS runs_cur,
    toInt64(uniqMergeIf(runs, bucket_date <  ?)) AS runs_prev
FROM tracium.metrics_daily WHERE %s GROUP BY name ORDER BY cost_cur DESC LIMIT ?`, clause)

	qArgs := append([]any{curDate, curDate, curDate, curDate}, args...)
	qArgs = append(qArgs, limit)
	rows, err := r.db.QueryContext(ctx, q, qArgs...)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: agent usage rollup: %w", err)
	}
	defer rows.Close()

	agents := []model.AgentUsage{}
	for rows.Next() {
		var a model.AgentUsage
		if err := rows.Scan(&a.Name, &a.Cost, &a.CostPrev, &a.Runs, &a.RunsPrev); err != nil {
			return nil, fmt.Errorf("clickhouse: scan agent usage: %w", err)
		}
		a.Cost, a.CostPrev = sanitize(a.Cost), sanitize(a.CostPrev)
		agents = append(agents, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := r.fillAgentModels(ctx, f, agents); err != nil {
		return nil, err
	}
	return agents, nil
}

// fillAgentModels sets each agent's most-used model: the model with the most
// spans for that agent over the current window. Runs can't be summed across
// models (a trace spanning two models would be counted twice), so the modal
// model is a separate span-count aggregation joined in Go by agent name.
func (r *ClickHouseRepository) fillAgentModels(ctx context.Context, f MetricsFilter, agents []model.AgentUsage) error {
	if len(agents) == 0 {
		return nil
	}
	clause, args := rollupWindow(f.TenantID, f.Start, f.End, true)
	q := fmt.Sprintf(`SELECT name, argMax(model, spans) AS model FROM (
    SELECT agent_name AS name, model, sum(span_count) AS spans
    FROM tracium.metrics_daily WHERE %s AND model != '' GROUP BY name, model
) GROUP BY name`, clause)

	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return fmt.Errorf("clickhouse: agent models rollup: %w", err)
	}
	defer rows.Close()

	idx := make(map[string]int, len(agents))
	for i := range agents {
		idx[agents[i].Name] = i
	}
	for rows.Next() {
		var name, modelName string
		if err := rows.Scan(&name, &modelName); err != nil {
			return fmt.Errorf("clickhouse: scan agent model: %w", err)
		}
		if i, ok := idx[name]; ok {
			agents[i].Model = modelName
		}
	}
	return rows.Err()
}

package query

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	// Import the ClickHouse driver to register it with database/sql.
	_ "github.com/ClickHouse/clickhouse-go/v2"

	"github.com/tracium/api/internal/model"
)

// ClickHouseRepository implements TraceRepository against a real ClickHouse instance.
type ClickHouseRepository struct {
	db *sql.DB
}

// NewClickHouseRepository opens a connection to ClickHouse using the given DSN.
func NewClickHouseRepository(dsn string) (*ClickHouseRepository, error) {
	db, err := sql.Open("clickhouse", dsn)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: open: %w", err)
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("clickhouse: ping: %w", err)
	}
	return &ClickHouseRepository{db: db}, nil
}

// A trace is the aggregation of all spans sharing a trace_id. start/end span the
// whole tree; has_error is true if any span carries an error_type.
// trace_name prefers the collector-derived agent_name (see the collector's
// agentName helper) so the displayed name matches the agent the trace is grouped
// under — and, crucially, shows the right name while a trace is still in flight:
// agent_name comes from the resource service.name, so it is present on the very
// first auto-instrumented span (e.g. "openai.chat"), whereas a wrapping root span
// carrying the operation name typically exports last. We fall back to the root
// span's name (the span with an empty parent_span_id) and finally the earliest
// span for rows written before agent_name existed (which read back empty). The
// root name is taken from the root span, not simply the earliest by start_time_ms:
// a span explicitly
// wrapping an auto-instrumented call starts in the same millisecond as its child,
// and a plain argMin would tie-break arbitrarily onto the child's name (e.g.
// "chat gpt-4o-mini").
// Aliases deliberately differ from the raw column names: an alias that shadows a
// column (e.g. AS start_time_ms) gets substituted back into argMin(name, start_time_ms),
// producing an illegal aggregate-inside-aggregate. count() is cast to Int64 so it
// scans into a Go int cleanly (it is UInt64 otherwise).
const traceSelect = `
SELECT
    trace_id,
    coalesce(nullIf(argMinIf(agent_name, start_time_ms, agent_name != ''), ''),
             nullIf(argMinIf(name, start_time_ms, parent_span_id = ''), ''),
             argMin(name, start_time_ms)) AS trace_name,
    any(tenant_id)                        AS trace_tenant,
    min(start_time_ms)                    AS started_ms,
    max(end_time_ms)                      AS ended_ms,
    max(end_time_ms) - min(start_time_ms) AS dur_ms,
    toInt64(count())                      AS spans,
    max(` + spanErrored + `)              AS errored,
    sum(cost_usd)                         AS total_cost
FROM tracium.spans`

// scanTrace reads one aggregated trace row. Works with both *sql.Row and *sql.Rows.
func scanTrace(s interface{ Scan(...any) error }) (model.Trace, error) {
	var t model.Trace
	var hasError uint8
	var spanCount int64
	err := s.Scan(&t.TraceID, &t.Name, &t.TenantID, &t.StartTimeMs, &t.EndTimeMs,
		&t.DurationMs, &spanCount, &hasError, &t.TotalCostUSD)
	t.HasError = hasError != 0
	t.SpanCount = int(spanCount)
	return t, err
}

// traceFilterSQL renders the WHERE/GROUP BY/HAVING clauses shared by the list
// query and its total-count companion, along with the positional args they bind.
// It stops short of ORDER BY/LIMIT so each caller can append its own tail.
func traceFilterSQL(filter TraceFilter) (string, []any) {
	var args []any

	// Every listing is time-bounded (StartAfter is defaulted in Validate) so the
	// query prunes to its window's granules — the spans table is ordered by
	// start_time_ms — rather than aggregating the whole table on every page load.
	clause := "\nWHERE start_time_ms >= ?"
	args = append(args, filter.StartAfter.UnixMilli())
	if !filter.StartBefore.IsZero() {
		clause += " AND start_time_ms < ?"
		args = append(args, filter.StartBefore.UnixMilli())
	}

	// source pins the listing to per-call spans (the same reasoning as window()
	// in metrics.go): metric-derived aggregate rows carry no trace_id, so without
	// this they all collapse into one phantom trace keyed on ''.
	clause += " AND source = ?"
	args = append(args, sourceSpan)

	// tenant_id is an optional business filter (the operator's end-client), not
	// an access boundary. Empty means "all clients" — read every trace.
	if filter.TenantID != "" {
		clause += " AND tenant_id = ?"
		args = append(args, filter.TenantID)
	}
	clause += "\nGROUP BY trace_id"

	var having []string
	if filter.Model != "" {
		having = append(having, "countIf(model = ?) > 0")
		args = append(args, filter.Model)
	}
	// Restrict to one derived agent (the same derivation the agents metrics use),
	// so an agent's "recent runs" list reuses the trace listing. The HAVING runs
	// inside the already time-bounded GROUP BY trace_id — still window-pruned.
	if filter.Agent != "" {
		having = append(having, agentExpr+" = ?")
		args = append(args, filter.Agent)
	}
	if filter.HasError != nil {
		hasError := uint8(0)
		if *filter.HasError {
			hasError = 1
		}
		having = append(having, "max("+spanErrored+") = ?")
		args = append(args, hasError)
	}
	if len(having) > 0 {
		clause += "\nHAVING " + strings.Join(having, " AND ")
	}
	return clause, args
}

// ListTraces returns a page of traces matching the given filter, newest first,
// plus the total number of matching traces across all pages so callers can size
// their pagination UI.
func (r *ClickHouseRepository) ListTraces(ctx context.Context, filter TraceFilter) ([]model.Trace, int64, error) {
	clause, filterArgs := traceFilterSQL(filter)

	// total counts the trace_id groups matching the filter, ignoring LIMIT/OFFSET.
	var total int64
	totalQ := "SELECT toInt64(count()) FROM (\nSELECT trace_id FROM tracium.spans" + clause + "\n)"
	if err := r.db.QueryRowContext(ctx, totalQ, filterArgs...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("clickhouse: count traces: %w", err)
	}

	q := traceSelect + clause + "\nORDER BY started_ms DESC\nLIMIT ? OFFSET ?"
	args := append(filterArgs, filter.PageSize, (filter.Page-1)*filter.PageSize)

	rows, err := r.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("clickhouse: list traces: %w", err)
	}
	defer rows.Close()

	traces := []model.Trace{}
	for rows.Next() {
		t, err := scanTrace(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("clickhouse: scan trace: %w", err)
		}
		traces = append(traces, t)
	}
	return traces, total, rows.Err()
}

// GetTrace returns a single aggregated trace by its ID.
func (r *ClickHouseRepository) GetTrace(ctx context.Context, traceID string) (*model.Trace, error) {
	// source = 'span' for symmetry with the listing: only per-call spans carry
	// trace identity, so metric rows can never contribute to a trace.
	q := traceSelect + "\nWHERE trace_id = ? AND source = ?\nGROUP BY trace_id"

	t, err := scanTrace(r.db.QueryRowContext(ctx, q, traceID, sourceSpan))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("clickhouse: get trace: %w", err)
	}
	return &t, nil
}

const spanSelect = `
SELECT trace_id, span_id, parent_span_id, name, start_time_ms, end_time_ms, duration_ms,
       model, model_normalized, input_tokens, output_tokens, cost_usd, tenant_id,
       finish_reason, error_type, error_message, schema_version,
       input, output, available_tools, kind
FROM tracium.spans
WHERE trace_id = ? AND source = ?
ORDER BY start_time_ms`

// GetSpans returns all spans for a given trace ID, ordered by start time.
func (r *ClickHouseRepository) GetSpans(ctx context.Context, traceID string) ([]model.Span, error) {
	rows, err := r.db.QueryContext(ctx, spanSelect, traceID, sourceSpan)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: get spans: %w", err)
	}
	defer rows.Close()

	spans := []model.Span{}
	for rows.Next() {
		var s model.Span
		var tools string // available_tools is stored as a JSON string column
		if err := rows.Scan(&s.TraceID, &s.SpanID, &s.ParentSpanID, &s.Name,
			&s.StartTimeMs, &s.EndTimeMs, &s.DurationMs, &s.Model, &s.ModelNormalized,
			&s.InputTokens, &s.OutputTokens, &s.CostUSD, &s.TenantID, &s.FinishReason,
			&s.ErrorType, &s.ErrorMessage, &s.SchemaVersion,
			&s.Input, &s.Output, &tools, &s.Kind); err != nil {
			return nil, fmt.Errorf("clickhouse: scan span: %w", err)
		}
		if tools != "" {
			if err := json.Unmarshal([]byte(tools), &s.AvailableTools); err != nil {
				return nil, fmt.Errorf("clickhouse: decode available_tools for span %s: %w", s.SpanID, err)
			}
		}
		spans = append(spans, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Roll up cost and tokens across the whole trace so each parent span reports
	// the totals for its subtree. Cheap: this runs over one trace's spans, not
	// the table.
	model.AssignSubtreeTotals(spans)
	return spans, nil
}

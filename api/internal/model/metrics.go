package model

// Metrics power the dashboard overview. All values are raw numbers; the
// dashboard owns formatting (currency, percentages, seconds).

// KPI is a single headline metric with its period-over-period change.
// Delta is a fraction (0.12 == +12%); DeltaType is "good" | "bad" | "neutral".
type KPI struct {
	Value     float64 `json:"value"`
	Delta     float64 `json:"delta"`
	DeltaType string  `json:"delta_type"`
}

// KPISet is the four headline metrics shown across the top of the overview.
type KPISet struct {
	Cost       KPI `json:"cost"`        // total cost, USD
	Runs       KPI `json:"runs"`        // agent runs (distinct traces)
	LatencyP95 KPI `json:"latency_p95"` // p95 trace duration, ms
	ErrorRate  KPI `json:"error_rate"`  // fraction of traces with an error
}

// CostPoint is one time bucket of total cost.
type CostPoint struct {
	BucketMs int64   `json:"bucket_ms"`
	Value    float64 `json:"value"`
}

// LatencyPoint is one time bucket of latency percentiles, in ms. The percentiles
// are pointers so a bucket with no runs serialises them as null rather than 0:
// latency is undefined when nothing ran, and a literal 0 would draw a misleading
// dip to the floor. The series is null-filled (not zero-filled like cost/error)
// over the full window so the x-axis still lines up with the cost chart.
type LatencyPoint struct {
	BucketMs int64    `json:"bucket_ms"`
	P50      *float64 `json:"p50"`
	P95      *float64 `json:"p95"`
	P99      *float64 `json:"p99"`
}

// AgentCost is one agent's spend over the window. Trend is the agent's call
// count per time bucket across the window (oldest first, zero-filled), powering
// the per-row usage sparkline.
type AgentCost struct {
	Name  string  `json:"name"`
	Cost  float64 `json:"cost"`
	Calls int64   `json:"calls"`
	Trend []int64 `json:"trend"`
}

// Agent is one agent's activity over the window, powering the Agents page table.
// It is the operational companion to AgentCost — same agent derivation
// (agentExpr) and call-count Trend sparkline — extended with the latency and
// reliability columns the table shows. AvgLatencyMs is mean end-to-end run
// duration; over a long window served from the daily rollup it is 0 (per-trace
// durations aren't retained — same limitation as LatencyP95). ErrorRate is the
// fraction of the agent's runs that errored.
type Agent struct {
	Name         string  `json:"name"`
	Calls        int64   `json:"calls"`
	Cost         float64 `json:"cost"`
	AvgLatencyMs float64 `json:"avg_latency_ms"`
	ErrorRate    float64 `json:"error_rate"`
	Trend        []int64 `json:"trend"`
	// LastTraceID is the agent's most recent trace in the window, so the UI can
	// deep-link a row straight to that trace's detail. Empty for long windows
	// served from the daily rollup, which doesn't retain trace identity.
	LastTraceID string `json:"last_trace_id"`
}

// ErrorPoint is one time bucket of run reliability: how many runs errored out
// of the total runs that started in the bucket. The dashboard renders these as
// the "Failures by day" horizon strip.
type ErrorPoint struct {
	BucketMs int64 `json:"bucket_ms"`
	Errors   int64 `json:"errors"`
	Total    int64 `json:"total"`
}

// AgentDetail is one agent's detail-page payload: its headline metrics over the
// window plus the tool surface from its most recent run. Span-backed only —
// there is no agent-config store, so runtime params (temperature, retries,
// version, owner, …) are not served. P95LatencyMs is a pointer so it serialises
// as null when undefined (no runs in the window). It is a raw-window payload
// (≤30d): the handler rejects rollup ranges, since per-agent latency can't be
// derived from the daily rollup (same limitation as LatencySeries).
type AgentDetail struct {
	Name         string          `json:"name"`
	Calls        int64           `json:"calls"`
	Cost         float64         `json:"cost"`
	AvgLatencyMs float64         `json:"avg_latency_ms"`
	P95LatencyMs *float64        `json:"p95_latency_ms"`
	ErrorRate    float64         `json:"error_rate"`
	InputTokens  int64           `json:"input_tokens"`
	OutputTokens int64           `json:"output_tokens"`
	Model        string          `json:"model"`    // modal model_normalized over the window
	Provider     string          `json:"provider"` // inferred from the model id; "" when unrecognised
	Tools        []AvailableTool `json:"tools"`    // union of available_tools from the latest run
	LastTraceID  string          `json:"last_trace_id"`
}

// Failure aggregates errored runs for one agent. Pct is the fraction of that
// agent's runs that failed.
type Failure struct {
	Agent    string  `json:"agent"`
	Count    int64   `json:"count"`
	Pct      float64 `json:"pct"`
	TopError string  `json:"top_error"`
}

// ModelCost is one model's spend over the window, powering the usage page's
// "Where it goes" list. Calls is the run (trace) count attributed to the model;
// InputTokens/OutputTokens are summed across its spans.
type ModelCost struct {
	Name         string  `json:"name"`
	Cost         float64 `json:"cost"`
	Calls        int64   `json:"calls"`
	InputTokens  int64   `json:"input_tokens"`
	OutputTokens int64   `json:"output_tokens"`
}

// TenantUsage is one tenant's spend over the current window paired with the
// equal-length preceding window, so the usage table can show per-column change.
// Trend is cost per time bucket across the current window (oldest first,
// zero-filled) for the row sparkline.
type TenantUsage struct {
	TenantID string    `json:"tenant_id"`
	Cost     float64   `json:"cost"`
	CostPrev float64   `json:"cost_prev"`
	Runs     int64     `json:"runs"`
	RunsPrev int64     `json:"runs_prev"`
	Trend    []float64 `json:"trend"`
}

// AgentUsage is one agent's spend over the current window paired with the
// preceding window (see TenantUsage). Model is the agent's most-used model.
type AgentUsage struct {
	Name     string  `json:"name"`
	Model    string  `json:"model"`
	Cost     float64 `json:"cost"`
	CostPrev float64 `json:"cost_prev"`
	Runs     int64   `json:"runs"`
	RunsPrev int64   `json:"runs_prev"`
}

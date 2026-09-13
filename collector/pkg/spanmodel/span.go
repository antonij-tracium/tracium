package spanmodel

// Span is the canonical in-memory representation of an LLM trace span.
// It is a pure data carrier — no business logic should live here.
// Validation belongs in ValidateStage; cost calculation belongs in EnrichStage.
type Span struct {
	// OTel standard fields
	TraceID      string
	SpanID       string
	ParentSpanID string
	Name         string
	StartTimeMs  int64
	EndTimeMs    int64
	DurationMs   int64

	// gen_ai.* semantic convention attributes
	Model        string
	InputTokens  int64
	OutputTokens int64
	FinishReason string

	// CacheReadTokens / CacheWriteTokens are the tokens served from / written to
	// a provider-managed prompt cache. They are read from the span's usage
	// attributes and used only to price the call accurately (most providers bill
	// cached tokens at a different rate); they are not stored as their own
	// columns. Whether InputTokens counts them too is provider-specific — see
	// pricing.Usage.
	CacheReadTokens  int64
	CacheWriteTokens int64

	// ReportedCostUSD is a cost the upstream instrumentation already computed
	// (gen_ai.usage.cost / llm.usage.total_cost). It is client-controlled — a
	// valid ingest key identifies the sender, not the truth of its numbers — so it
	// is IGNORED unless the operator opts in via PricingEnricher.TrustReportedCost;
	// otherwise the price table wins.
	ReportedCostUSD float64

	// tracium.* enriched attributes (set by EnrichStage)
	CostUSD         float64
	UserID        string
	// WorkspaceID scopes a span to a workspace (the isolation/allocation unit an
	// account owns). Passthrough from the tracium.workspace.id attribute, like
	// UserID — a client-controlled label, not resolved.
	WorkspaceID     string
	ModelNormalized string
	SchemaVersion   int
	ErrorType       string
	ErrorMessage    string

	// WorkflowName identifies the workflow that owns this span, so the query layer
	// can group traces per workflow instead of by the raw span name. Derived by the
	// exporter from the first non-empty of: gen_ai.agent.name,
	// traceloop.workflow.name, traceloop.entity.name, the resource attribute
	// service.name, or the span name as a last resort. The span-scoped signals
	// come first so a trace made of many sub-spans attributes each span to its real
	// workflow.
	WorkflowName string

	// ServiceName is the resource-level service.name, persisted verbatim (the
	// OTel "unknown_service" default is stored as empty). Kept as its own column
	// so the query layer has a stable, always-present name for a trace's in-flight
	// display — present on the very first auto-instrumented span — without folding
	// it into WorkflowName and losing per-workflow attribution.
	ServiceName string

	// Source records how this row entered Tracium: "span" for a real per-call
	// span (the default) or "metric" for an aggregate synthesised from an OTLP
	// token-usage metric. The query layer uses it to keep trace-shaped
	// aggregates (counts, latency) span-only while letting cost/token totals
	// prefer metrics. An empty value is persisted as "span".
	Source string

	// Content & tools (schema v3). Input/Output carry raw prompt/completion
	// text and are only populated when content capture is enabled. AvailableTools
	// is the JSON-encoded tracium.available_tools attribute, passed through
	// verbatim — the collector stores it without parsing.
	Input          string
	Output         string
	AvailableTools string

	// OutputTokensDerived records that OutputTokens was not reported whole by the
	// provider: part of it was reconciled from total_tokens (Gemini bills
	// thinking tokens that OpenLLMetry never maps onto output_tokens). Kept
	// distinct so a derived count is never mistaken for a provider-reported one.
	OutputTokensDerived bool

	// Unmetered records a span that billed real money but carries no usage at
	// all — a streamed call made without stream_options={"include_usage": True}
	// lands with a model and a completion but zero tokens. Without this flag its
	// $0 is indistinguishable from a call that genuinely cost nothing.
	Unmetered bool

	// Kind is the normalized span role (agent, llm, tool, chain, retriever,
	// embedding), derived by the exporter from instrumentation attributes. Empty
	// when the span could not be classified; the API omits the empty value and
	// the dashboard infers the role from the span's position in the trace.
	Kind string

	// Attributes carries the span's custom key-value attributes — everything the
	// instrumentation attached that Tracium does not promote to a typed column:
	// business tags the operator allocates by (team, user.id, environment,
	// customer, cost_center, …). Merged from resource- and span-level OTLP
	// attributes, with the promoted/content namespaces (gen_ai.*, tracium.*,
	// llm.*, traceloop.*, service.name) excluded so they are not duplicated.
	// Stored as a ClickHouse Map(String,String) so the query layer can group and
	// filter by any key without a schema change — the "send a tag, slice by it"
	// contract every observability tool provides.
	Attributes map[string]string
}

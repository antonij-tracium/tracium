package clickhousespanexporter

import (
	"context"
	"strings"

	"github.com/tracium/collector/internal/genai"
	"github.com/tracium/collector/internal/writer"
	"github.com/tracium/collector/pkg/spanmodel"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

type chExporter struct {
	writer *writer.ClickHouseWriter

	// trustReportedCost mirrors enrich.PricingEnricher.TrustReportedCost and
	// must stay the same decision: a cost the client declared itself is ignored
	// unless the operator opted in. Default false. See fromOTLP.
	trustReportedCost bool
}

// pushTraces flattens an OTLP batch into spanmodel.Span rows and writes them in
// a single ClickHouse batch. It expects spans already enriched by the tracium
// processor (tracium.* attributes present).
func (e *chExporter) pushTraces(ctx context.Context, td ptrace.Traces) error {
	spans := make([]*spanmodel.Span, 0, td.SpanCount())

	rss := td.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		// service.name is a resource-level attribute shared by every span in the
		// batch; it is the most stable agent identity, so we lift it out once and
		// pass it down to each span's agent-name derivation.
		resourceAttrs := rss.At(i).Resource().Attributes()
		serviceName := strAttr(resourceAttrs, attrServiceName)
		sss := rss.At(i).ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			ss := sss.At(j).Spans()
			for k := 0; k < ss.Len(); k++ {
				spans = append(spans, fromOTLP(ss.At(k), serviceName, resourceAttrs, e.trustReportedCost))
			}
		}
	}
	return e.writer.WriteBatch(ctx, spans)
}

// Attribute keys mirror traciumprocessor; duplicated here to keep the exporter
// independently usable (it can ingest pre-enriched spans from any source).
const (
	attrModelRequest  = "gen_ai.request.model"
	attrModelResponse = "gen_ai.response.model"
	attrFinishReason  = "gen_ai.response.finish_reasons"
	// Dotted to match the key the tracium processor writes on enriched spans
	// (writeBack → tracium.user.id). The underscore form left span rows with
	// an empty user_id in the processor→exporter pipeline.
	attrUserID        = "tracium.user.id"
	attrWorkspaceID     = "tracium.workspace.id"
	attrCostUSD         = "tracium.cost_usd"
	attrModelNormalized = "tracium.model_normalized"
	attrSchemaVersion   = "tracium.schema_version"
	attrAvailableTools  = "tracium.available_tools"

	// Agent-identity signals. The span-scoped semconv/decorator names come first
	// (they name the actual agent that owns this span); the resource-level
	// service.name is only a fallback. service.name is also persisted on its own
	// column so the query layer keeps a stable, always-present name for in-flight
	// traces without conflating it with agent identity.
	attrServiceName       = "service.name"
	attrGenAIAgentName    = "gen_ai.agent.name"
	attrTraceloopWorkflow = "traceloop.workflow.name"
	attrTraceloopEntity   = "traceloop.entity.name"
)

func fromOTLP(s ptrace.Span, serviceName string, resourceAttrs pcommon.Map, trustReportedCost bool) *spanmodel.Span {
	attrs := s.Attributes()
	model := strAttr(attrs, attrModelRequest)
	if model == "" {
		model = strAttr(attrs, attrModelResponse)
	}
	am := attrMap(attrs)
	usage := genai.Usage(am)
	startMs := s.StartTimestamp().AsTime().UnixMilli()
	endMs := s.EndTimestamp().AsTime().UnixMilli()

	// Flatten whatever content attributes survived the processor's capture gate
	// (both OTel gen_ai.*.messages and OpenLLMetry indexed shapes). When capture
	// is disabled these were stripped, so input/output come back empty.
	input, output := genai.Content(am)

	// Cost is normally set by the processor (tracium.cost_usd). Spans can also
	// reach this exporter without passing through the processor's pricing step,
	// so a client-reported cost (gen_ai.usage.cost) is the only fallback — but
	// it is used only where the operator has declared that source trustworthy,
	// exactly as enrich.PricingEnricher.TrustReportedCost does.
	//
	// A valid ingest key authenticates the sender, not the truth of its numbers,
	// so trusting a client-reported cost unconditionally still lets any
	// authenticated sender declare a span worth $1,000,000 and have it stored
	// verbatim — and every cost figure in the product is a sum(cost_usd). A zero
	// from the processor means "the price table could not
	// price this model", not "ask the client"; such a span is stored at 0, and
	// stays visible as a row with tokens but no cost.
	cost := floatAttr(attrs, attrCostUSD)
	if trustReportedCost && cost == 0 && usage.ReportedCostUSD > 0 {
		cost = usage.ReportedCostUSD
	}

	errType, errMessage := spanError(s)

	return &spanmodel.Span{
		TraceID:         s.TraceID().String(),
		SpanID:          s.SpanID().String(),
		ParentSpanID:    s.ParentSpanID().String(),
		Name:            s.Name(),
		StartTimeMs:     startMs,
		EndTimeMs:       endMs,
		DurationMs:      endMs - startMs,
		Model:           model,
		ModelNormalized: strAttr(attrs, attrModelNormalized),
		InputTokens:     usage.InputTokens,
		OutputTokens:    usage.OutputTokens,
		// Both flags are metering provenance, not usage: they say how much of the
		// count above is trustworthy. Stored so a $0 span is distinguishable from
		// a genuinely free one.
		OutputTokensDerived: usage.OutputTokensDerived,
		Unmetered:           usage.Unmetered,
		FinishReason:        finishReason(attrs),
		Kind:                spanKind(attrs, model, usage.InputTokens, usage.OutputTokens),
		CostUSD:             cost,
		UserID:            strAttr(attrs, attrUserID),
		WorkspaceID:         workspaceID(attrs, resourceAttrs),
		SchemaVersion:       int(intAttr(attrs, attrSchemaVersion)),
		ErrorType:           errType,
		ErrorMessage:        errMessage,
		AgentName: agentName(
			serviceName,
			strAttr(attrs, attrGenAIAgentName),
			strAttr(attrs, attrTraceloopWorkflow),
			strAttr(attrs, attrTraceloopEntity),
			s.Name(),
		),
		// ServiceName is the resource-level service.name, persisted verbatim (the
		// OTel "unknown_service" default treated as absent). The query layer uses
		// it as the stable in-flight fallback for a trace's display/agent name.
		ServiceName: resourceServiceName(serviceName),
		// Content is absent unless the processor kept it (capture enabled);
		// available_tools is collector-computed metadata, passed through verbatim.
		Input:          input,
		Output:         output,
		AvailableTools: strAttr(attrs, attrAvailableTools),
		Attributes:     customAttributes(resourceAttrs, attrs),
	}
}

// Ingest bounds for the custom-attribute map. The OTLP ports are
// unauthenticated, so a span's attribute bag is capped before it can reach
// storage — without a ceiling a client could attach thousands of oversized keys
// and bloat every row. These are generous; a working instrumentation stays well
// under them.
const (
	maxAttrs          = 64 // custom keys retained per span
	maxAttrKeyBytes   = 128
	maxAttrValueBytes = 256
)

// attrDenyPrefixes are the namespaces Tracium already promotes to typed columns
// or stores as content. Keeping them in the custom-attribute map would duplicate
// promoted data (model, tokens, cost, user, agent) or store large
// prompt/completion text; everything outside them is a custom business attribute
// the operator can allocate by, retained verbatim.
var attrDenyPrefixes = []string{"gen_ai.", "tracium.", "llm.", "traceloop."}

// attrDenyKeys are promoted keys that don't share a denied prefix.
var attrDenyKeys = map[string]bool{attrServiceName: true}

// customAttributes merges a span's resource- and span-level OTLP attributes into
// the flat map Tracium stores for allocation, dropping the promoted/content
// namespaces and applying the ingest caps above. Span-level keys win over
// resource-level ones. Returns nil when nothing custom is present.
func customAttributes(resourceAttrs, spanAttrs pcommon.Map) map[string]string {
	out := make(map[string]string)
	add := func(m pcommon.Map) {
		m.Range(func(k string, v pcommon.Value) bool {
			if len(k) == 0 || len(k) > maxAttrKeyBytes || isDeniedAttr(k) {
				return true
			}
			// Cap the number of distinct keys, but always allow a span-level key
			// to overwrite a resource-level one already stored.
			if _, exists := out[k]; !exists && len(out) >= maxAttrs {
				return true
			}
			val := v.AsString()
			if len(val) > maxAttrValueBytes {
				val = strings.ToValidUTF8(val[:maxAttrValueBytes], "")
			}
			out[k] = val
			return true
		})
	}
	add(resourceAttrs)
	add(spanAttrs)
	if len(out) == 0 {
		return nil
	}
	return out
}

func isDeniedAttr(k string) bool {
	if attrDenyKeys[k] {
		return true
	}
	for _, p := range attrDenyPrefixes {
		if strings.HasPrefix(k, p) {
			return true
		}
	}
	return false
}

// agentName picks the agent that owns this span, preferring span-scoped signals
// over the resource-level service.name so a multi-agent trace attributes each
// span to its real agent instead of collapsing every agent under one service.
// Priority: gen_ai.agent.name, traceloop.workflow.name, traceloop.entity.name,
// then service.name, then the span name as a last resort. The OTel SDK default
// of "unknown_service" (optionally suffixed with the process name) is treated as
// absent — grouping under it would be as useless as grouping under a raw
// operation name like "openai.chat". The stability the resource service.name
// used to provide (present on the very first auto-instrumented span, before any
// invoke_agent span exports) is preserved by persisting it as its own column and
// letting the query layer fall back to it for a trace's in-flight name.
func agentName(serviceName, genaiAgent, traceloopWorkflow, traceloopEntity, spanName string) string {
	for _, c := range []string{genaiAgent, traceloopWorkflow, traceloopEntity, resourceServiceName(serviceName), spanName} {
		if name := strings.TrimSpace(c); name != "" {
			return name
		}
	}
	return ""
}

// resourceServiceName returns the usable service.name, treating the OTel SDK
// default "unknown_service" (optionally "unknown_service:<process>") as absent.
func resourceServiceName(serviceName string) string {
	if strings.HasPrefix(serviceName, "unknown_service") {
		return ""
	}
	return strings.TrimSpace(serviceName)
}

// OTel records failures as a first-class span status plus (optionally) an
// "exception" event carrying the type/message — never as a gen_ai.* attribute.
// These keys read that event; the constants follow the OTel exception semantic
// conventions.
const (
	eventException       = "exception"
	attrExceptionType    = "exception.type"
	attrExceptionMessage = "exception.message"
)

// spanError derives the error_type/error_message columns from an OTLP span.
// Returns empty strings unless the span's status code is Error, so successful
// and unset spans stay error-free. When present, an "exception" event supplies
// the most specific type/message (e.g. the SDK exception class and API error
// text); otherwise we fall back to a generic type and the status message.
func spanError(s ptrace.Span) (errType, errMessage string) {
	if s.Status().Code() != ptrace.StatusCodeError {
		return "", ""
	}

	events := s.Events()
	for i := 0; i < events.Len(); i++ {
		ev := events.At(i)
		if ev.Name() != eventException {
			continue
		}
		errType = strAttr(ev.Attributes(), attrExceptionType)
		errMessage = strAttr(ev.Attributes(), attrExceptionMessage)
		break
	}

	if errType == "" {
		errType = "error"
	}
	if errMessage == "" {
		errMessage = s.Status().Message()
	}
	return errType, errMessage
}

// attrMap snapshots a span's attributes as a plain string map for the
// framework-free genai helper.
func attrMap(m pcommon.Map) map[string]string {
	out := make(map[string]string, m.Len())
	m.Range(func(k string, v pcommon.Value) bool {
		out[k] = v.AsString()
		return true
	})
	return out
}

// finishReason reads gen_ai.response.finish_reasons, which the OTel GenAI
// semantic conventions define as an *array*. We store the first element: a span
// describes a single model call, so anything past the first is degenerate, and
// a scalar is what the finish_reason column's equality filters can match.
//
// Reading it with strAttr instead would JSON-encode the array to `["length"]`,
// which no dashboard filter or WHERE finish_reason = 'length' ever matches.
// Instrumentations that send a bare string are handled by the fallback.
// Duplicated in traciumprocessor, per this file's independent-usability rule.
func finishReason(attrs pcommon.Map) string {
	v, ok := attrs.Get(attrFinishReason)
	if !ok {
		return ""
	}
	if v.Type() != pcommon.ValueTypeSlice {
		return v.AsString()
	}
	if s := v.Slice(); s.Len() > 0 {
		return s.At(0).AsString()
	}
	return ""
}

// workspaceID reads tracium.workspace.id from the span, falling back to the
// resource. The processor promotes the resource value onto the span, but the
// exporter is independently usable (it can ingest spans that never passed
// through the processor), so it checks the resource too.
func workspaceID(spanAttrs, resourceAttrs pcommon.Map) string {
	if v := strAttr(spanAttrs, attrWorkspaceID); v != "" {
		return v
	}
	return strAttr(resourceAttrs, attrWorkspaceID)
}

func strAttr(attrs pcommon.Map, key string) string {
	if v, ok := attrs.Get(key); ok {
		return v.AsString()
	}
	return ""
}

func intAttr(attrs pcommon.Map, key string) int64 {
	if v, ok := attrs.Get(key); ok {
		return v.Int()
	}
	return 0
}

func floatAttr(attrs pcommon.Map, key string) float64 {
	if v, ok := attrs.Get(key); ok {
		return v.Double()
	}
	return 0
}

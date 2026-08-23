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
		serviceName := strAttr(rss.At(i).Resource().Attributes(), attrServiceName)
		sss := rss.At(i).ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			ss := sss.At(j).Spans()
			for k := 0; k < ss.Len(); k++ {
				spans = append(spans, fromOTLP(ss.At(k), serviceName, e.trustReportedCost))
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
	// (writeBack → tracium.tenant.id). The underscore form left span rows with
	// an empty tenant_id in the processor→exporter pipeline.
	attrTenantID        = "tracium.tenant.id"
	attrCostUSD         = "tracium.cost_usd"
	attrModelNormalized = "tracium.model_normalized"
	attrSchemaVersion   = "tracium.schema_version"
	attrAvailableTools  = "tracium.available_tools"

	// Agent-identity signals, in fallback order after the resource service.name.
	attrServiceName       = "service.name"
	attrGenAIAgentName    = "gen_ai.agent.name"
	attrTraceloopWorkflow = "traceloop.workflow.name"
	attrTraceloopEntity   = "traceloop.entity.name"
)

func fromOTLP(s ptrace.Span, serviceName string, trustReportedCost bool) *spanmodel.Span {
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
	// The OTLP ports are unauthenticated, so trusting it unconditionally lets
	// anyone who can reach the collector declare a span worth $1,000,000 and
	// have it stored verbatim — and every cost figure in the product is a
	// sum(cost_usd). A zero from the processor means "the price table could not
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
		TenantID:            strAttr(attrs, attrTenantID),
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
		// Content is absent unless the processor kept it (capture enabled);
		// available_tools is collector-computed metadata, passed through verbatim.
		Input:          input,
		Output:         output,
		AvailableTools: strAttr(attrs, attrAvailableTools),
	}
}

// agentName picks the agent identity for a span's trace as the first usable
// signal in priority order: resource service.name, gen_ai.agent.name,
// traceloop.workflow.name, traceloop.entity.name, then the span name as a last
// resort. The OTel SDK default of "unknown_service" (optionally suffixed with
// the process name) is treated as absent — grouping under it would be as
// useless as grouping under a raw operation name like "openai.chat".
func agentName(serviceName, genaiAgent, traceloopWorkflow, traceloopEntity, spanName string) string {
	if !strings.HasPrefix(serviceName, "unknown_service") {
		if name := strings.TrimSpace(serviceName); name != "" {
			return name
		}
	}
	for _, c := range []string{genaiAgent, traceloopWorkflow, traceloopEntity, spanName} {
		if name := strings.TrimSpace(c); name != "" {
			return name
		}
	}
	return ""
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

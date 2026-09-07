package traciumprocessor

import (
	"context"
	"errors"

	"github.com/tracium/collector/enrich"
	"github.com/tracium/collector/internal/deadletter"
	customerrors "github.com/tracium/collector/internal/errors"
	"github.com/tracium/collector/internal/genai"
	"github.com/tracium/collector/pkg/spanmodel"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.uber.org/zap"
)

// traciumProcessor maps OTLP trace spans to the Tracium span model, runs the
// enrichment chain, and writes the enriched values back as span attributes.
// Spans the chain drops (invalid or filtered) are removed from the batch — and,
// per Rule 1, counted and dead-lettered on the way out rather than vanishing.
type traciumProcessor struct {
	logger         *zap.Logger
	chain          *enrich.Chain
	captureContent bool

	// deadLetter receives every dropped span with its error code attached.
	deadLetter deadletter.Store
	// dropped counts dropped spans by error code. The processor mutates the
	// batch in place, so processorhelper counts every span as accepted — this
	// counter is the only signal that anything was discarded.
	dropped metric.Int64Counter
}

// processTraces is the processorhelper ProcessTracesFunc. Returning an error
// signals a retryable failure to the collector's queue/retry machinery.
func (p *traciumProcessor) processTraces(ctx context.Context, td ptrace.Traces) (ptrace.Traces, error) {
	var retryErr error

	rss := td.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		rs := rss.At(i)
		resourceAttrs := rs.Resource().Attributes()
		sss := rs.ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			spans := sss.At(j).Spans()
			spans.RemoveIf(func(otelSpan ptrace.Span) bool {
				// Snapshot the attributes once and reuse the map for model
				// extraction, tool detection, and content flattening — building it
				// per concern would copy every attribute (incl. content) twice on
				// the ingest hot path.
				attrs := attrMap(otelSpan.Attributes())
				model := toSpanModel(otelSpan, resourceAttrs, attrs)
				res, err := applyChain(ctx, p.chain, model)
				if res == enrich.ResultDrop {
					// Permanently rejected: count it and dead-letter it before
					// removing it from the batch.
					p.recordDrop(ctx, model, err)
					return true
				}
				if err != nil {
					// Retryable transient failure — keep the span and fail the
					// batch so the collector retries the whole batch.
					retryErr = err
					return false
				}
				writeBack(otelSpan, model)
				// Compute available_tools from the full attribute set before any
				// content is stripped (tool-call signals live in the completion).
				stampAvailableTools(otelSpan, attrs)
				if !p.captureContent {
					stripContent(otelSpan)
				}
				return false
			})
		}
	}

	if retryErr != nil {
		return td, retryErr
	}
	return td, nil
}

// applyChain runs the enrichment chain like enrich.Chain.Apply, but preserves
// the error behind a drop instead of collapsing it to (ResultDrop, nil).
// Rule 1 requires the span's error code to travel with it to the dead-letter
// store, and Apply's signature discards it. The classification below mirrors
// Apply exactly — keep the two in sync until Apply itself returns the cause.
func applyChain(ctx context.Context, c *enrich.Chain, span *spanmodel.Span) (enrich.Result, error) {
	for _, e := range c.Enrichers() {
		err := e.Enrich(ctx, span)
		if err == nil {
			continue
		}
		switch {
		case customerrors.IsSpanError(err):
			// Permanent, span-level problem — drop it.
			return enrich.ResultDrop, err
		case customerrors.IsTransient(err) && !customerrors.IsRetryable(err):
			// Temporary but not worth retrying — drop it.
			return enrich.ResultDrop, err
		default:
			// Retryable transient (or unknown) — surface for the retry queue.
			return enrich.ResultKeep, err
		}
	}
	return enrich.ResultKeep, nil
}

// recordDrop makes a discarded span observable and recoverable: it counts the
// drop by error code (so operators can alert on it) and hands the span to the
// dead-letter store. Per Rule 1 no span leaves the pipeline without both.
func (p *traciumProcessor) recordDrop(ctx context.Context, span *spanmodel.Span, cause error) {
	code := dropCode(cause)
	var reason string
	if cause != nil {
		reason = cause.Error()
	}

	if p.dropped != nil {
		p.dropped.Add(ctx, 1, metric.WithAttributes(attribute.String("code", code)))
	}
	if p.deadLetter == nil {
		return
	}
	if err := p.deadLetter.Put(ctx, deadletter.Record{Code: code, Reason: reason, Span: span}); err != nil {
		// The span is already lost; an unusable sink is an operator problem, not
		// a reason to fail (and endlessly retry) the whole batch.
		p.logger.Error("dead-letter store rejected a span",
			zap.String("code", code), zap.Error(err))
	}
}

// dropCode names why a span was dropped, reading the code off whichever typed
// error caused it: a SpanError (bad data) or a non-retryable TransientError.
func dropCode(err error) string {
	if code := customerrors.SpanErrorCode_(err); code != "" {
		return string(code)
	}
	var te *customerrors.TransientError
	if errors.As(err, &te) {
		return string(te.Code)
	}
	return "unknown"
}

// Attribute keys: gen_ai.* follow OTel semantic conventions; tracium.* are the
// enriched outputs this processor produces.
const (
	attrModelRequest  = "gen_ai.request.model"
	attrModelResponse = "gen_ai.response.model"
	attrFinishReason  = "gen_ai.response.finish_reasons"

	attrUserID        = "tracium.user.id"
	attrWorkspaceID     = "tracium.workspace.id"
	attrCostUSD         = "tracium.cost_usd"
	attrModelNormalized = "tracium.model_normalized"
	attrSchemaVersion   = "tracium.schema_version"
	attrAvailableTools  = "tracium.available_tools"
)

// toSpanModel extracts the fields the enrichment chain needs from an OTLP span.
// attrs is the span's attribute map, snapshotted once by the caller.
func toSpanModel(s ptrace.Span, resourceAttrs pcommon.Map, attrs map[string]string) *spanmodel.Span {
	model := attrs[attrModelRequest]
	if model == "" {
		model = attrs[attrModelResponse]
	}

	// User may arrive on the span or on the resource.
	userID := attrs[attrUserID]
	if userID == "" {
		if v, ok := resourceAttrs.Get(attrUserID); ok {
			userID = v.AsString()
		}
	}

	// Workspace, likewise, may arrive on the span or on the resource.
	workspaceID := attrs[attrWorkspaceID]
	if workspaceID == "" {
		if v, ok := resourceAttrs.Get(attrWorkspaceID); ok {
			workspaceID = v.AsString()
		}
	}

	startMs := s.StartTimestamp().AsTime().UnixMilli()
	endMs := s.EndTimestamp().AsTime().UnixMilli()

	// Token counts and any upstream-reported cost, resolved across the semconv
	// and OpenLLMetry attribute names so legacy Traceloop spans price correctly.
	usage := genai.Usage(attrs)

	return &spanmodel.Span{
		TraceID:          s.TraceID().String(),
		SpanID:           s.SpanID().String(),
		ParentSpanID:     s.ParentSpanID().String(),
		Name:             s.Name(),
		StartTimeMs:      startMs,
		EndTimeMs:        endMs,
		DurationMs:       endMs - startMs,
		Model:            model,
		InputTokens:      usage.InputTokens,
		OutputTokens:     usage.OutputTokens,
		CacheReadTokens:  usage.CacheReadTokens,
		CacheWriteTokens: usage.CacheWriteTokens,
		ReportedCostUSD:  usage.ReportedCostUSD,
		// Read from the raw attributes, not the flattened attrs map: the map
		// holds the JSON-encoded array (see finishReason).
		FinishReason: finishReason(s.Attributes()),
		UserID:     userID,
		WorkspaceID:  workspaceID,
	}
}

// writeBack stamps the enriched fields onto the OTLP span as attributes.
func writeBack(s ptrace.Span, m *spanmodel.Span) {
	attrs := s.Attributes()
	attrs.PutDouble(attrCostUSD, m.CostUSD)
	attrs.PutStr(attrModelNormalized, m.ModelNormalized)
	attrs.PutInt(attrSchemaVersion, int64(m.SchemaVersion))
	if m.UserID != "" {
		attrs.PutStr(attrUserID, m.UserID)
	}
	if m.WorkspaceID != "" {
		attrs.PutStr(attrWorkspaceID, m.WorkspaceID)
	}
}

// stampAvailableTools computes the tracium.available_tools attribute from the
// upstream tool-definition and tool-call attributes. It is metadata (not raw
// content), so it is stamped regardless of the capture_content setting. No-op
// when the span offered no tools.
func stampAvailableTools(s ptrace.Span, attrs map[string]string) {
	if tools := genai.ToolsJSON(attrs); tools != "" {
		s.Attributes().PutStr(attrAvailableTools, tools)
	}
}

// stripContent removes raw prompt/completion content attributes (both the OTel
// and OpenLLMetry shapes, per genai.IsContentKey) so they never reach the
// exporter (and thus storage) when content capture is disabled. Tool-definition
// attributes are metadata and deliberately kept.
func stripContent(s ptrace.Span) {
	s.Attributes().RemoveIf(func(k string, _ pcommon.Value) bool {
		return genai.IsContentKey(k)
	})
}

// finishReason reads gen_ai.response.finish_reasons, which the OTel GenAI
// semantic conventions define as an *array*. We store the first element: a span
// describes a single model call, so anything past the first is degenerate, and
// a scalar is what equality filters (finish_reason = 'length') can match.
//
// Reading the value with AsString() instead would JSON-encode the array to
// `["length"]`, which no filter ever matches. Instrumentations that send a bare
// string are handled by the fallback.
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

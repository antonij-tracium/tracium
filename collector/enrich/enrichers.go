package enrich

import (
	"context"
	"strings"
	"unicode"

	customerrors "github.com/tracium/collector/internal/errors"
	"github.com/tracium/collector/internal/pricing"
	"github.com/tracium/collector/internal/tenant"
	"github.com/tracium/collector/pkg/spanmodel"
)

// DefaultChain assembles the OSS enrichment chain in the canonical order:
// validate → normalize model → resolve tenant → resolve pricing → filter.
//
// The Enterprise edition can call this and wrap or extend the result, e.g.
//
//	base := enrich.DefaultChain(cfg)
//	chain := enrich.NewChain(append(base.Enrichers(), ee.QuotaEnricher{}, ee.PIIRedactor{})...)
//
// pricingResolver and tenantResolver may be nil; the corresponding step is then
// skipped (useful in local dev). allowedModels may be empty to allow all models.
func DefaultChain(
	pricingResolver pricing.Resolver,
	tenantResolver tenant.Resolver,
	allowedModels []string,
) *Chain {
	return NewChain(
		ValidateEnricher{},
		NormalizeModelEnricher{},
		TenantEnricher{Resolver: tenantResolver},
		PricingEnricher{Resolver: pricingResolver},
		NewFilterEnricher(allowedModels),
	)
}

// ---------------------------------------------------------------------------
// Ingest sanity bounds.
//
// Everything below arrives from an unauthenticated OTLP port, so every
// client-controlled field is bounded before it can reach storage. The bounds are
// set far above anything a working client can produce: crossing one means the
// client is broken, not that the call was unusual.
// ---------------------------------------------------------------------------

const (
	// maxTokensPerCall caps any single token count on one span. The largest
	// context window advertised by any model today is ~10M tokens, so this
	// leaves an order of magnitude of headroom. Without a ceiling a span
	// claiming 2^62 tokens prices at ~$3.4 trillion, and since every aggregate
	// is a sum(cost_usd), one such span destroys the cost figures for everyone.
	maxTokensPerCall = 100_000_000

	// maxModelNameBytes caps gen_ai.request.model. metrics_daily types its
	// model column as LowCardinality(String) and feeds it from the (client
	// controlled) normalized model name; unbounded values degrade the one
	// rollup that keeps 90d/1y windows affordable. An id longer than this is
	// not a model id.
	maxModelNameBytes = 256

	// maxTenantIDBytes caps the tenant label, which is likewise a
	// LowCardinality grouping key in metrics_daily.
	maxTenantIDBytes = 128
)

// ---------------------------------------------------------------------------
// ValidateEnricher — rejects spans missing required identity/timing fields.
// ---------------------------------------------------------------------------

// ValidateEnricher fails fast on structurally invalid spans. It must run first.
type ValidateEnricher struct{}

// Name implements Enricher.
func (ValidateEnricher) Name() string { return "validate" }

// Enrich implements Enricher.
func (ValidateEnricher) Enrich(_ context.Context, span *spanmodel.Span) error {
	if span.TraceID == "" {
		return customerrors.InvalidSpan(customerrors.ErrMissingTraceID, "trace_id is empty")
	}
	if span.SpanID == "" {
		return customerrors.InvalidSpan(customerrors.ErrMissingSpanID, "span_id is empty")
	}
	if span.StartTimeMs <= 0 {
		return customerrors.InvalidSpanf(customerrors.ErrInvalidTimestamp,
			"start_time_ms must be positive, got %d", span.StartTimeMs)
	}
	// A span that ends before it starts has no trustworthy timing: its duration
	// is negative, which drags the enclosing trace's latency
	// (max(end) - min(start)) and every p95 below zero. Rejected rather than
	// clamped to 0, for two reasons: the clamp could not take effect anyway
	// (only the tracium.* attributes are written back to the OTLP span, and the
	// exporter recomputes duration from the original timestamps), and a clamped
	// span would silently report a plausible 0ms latency for a call whose clock
	// we know to be wrong. Dead-lettered with its code, never silently dropped.
	if span.EndTimeMs != 0 && span.EndTimeMs < span.StartTimeMs {
		return customerrors.InvalidSpanf(customerrors.ErrInvalidTimestamp,
			"end_time_ms %d precedes start_time_ms %d", span.EndTimeMs, span.StartTimeMs)
	}
	if len(span.Model) > maxModelNameBytes {
		return customerrors.InvalidSpanf(customerrors.ErrFieldTooLong,
			"model name is %d bytes, limit is %d", len(span.Model), maxModelNameBytes)
	}
	for _, tc := range []struct {
		field string
		count int64
	}{
		{"input_tokens", span.InputTokens},
		{"output_tokens", span.OutputTokens},
		{"cache_read_tokens", span.CacheReadTokens},
		{"cache_write_tokens", span.CacheWriteTokens},
	} {
		if tc.count > maxTokensPerCall {
			return customerrors.InvalidSpanf(customerrors.ErrTokenCountOutOfRange,
				"%s is %d, limit is %d", tc.field, tc.count, maxTokensPerCall)
		}
	}
	return nil
}

// sanitizeIdentifier makes a client-supplied identifier safe to store and to
// group by: control characters (null bytes, newlines) are dropped and the result
// is capped at maxBytes on a valid UTF-8 boundary.
func sanitizeIdentifier(s string, maxBytes int) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.TrimSpace(s))
	if len(s) <= maxBytes {
		return s
	}
	return strings.ToValidUTF8(s[:maxBytes], "")
}

// ---------------------------------------------------------------------------
// NormalizeModelEnricher — canonicalises the model name and schema version.
// ---------------------------------------------------------------------------

// NormalizeModelEnricher lower-cases, trims and sanitises the model name into
// ModelNormalized, which downstream pricing and filtering rely on — and which
// the daily rollup stores in a LowCardinality column.
type NormalizeModelEnricher struct{}

// Name implements Enricher.
func (NormalizeModelEnricher) Name() string { return "normalize-model" }

// Enrich implements Enricher.
func (NormalizeModelEnricher) Enrich(_ context.Context, span *spanmodel.Span) error {
	span.ModelNormalized = sanitizeIdentifier(strings.ToLower(span.Model), maxModelNameBytes)
	if span.SchemaVersion == 0 {
		span.SchemaVersion = 1
	}
	return nil
}

// ---------------------------------------------------------------------------
// TenantEnricher — resolves the tenant ID when not already set on the span.
// ---------------------------------------------------------------------------

// TenantEnricher fills span.TenantID via the configured Resolver. A nil Resolver
// leaves any existing TenantID untouched (e.g. when tenancy is carried in OTLP
// resource attributes upstream).
type TenantEnricher struct {
	Resolver tenant.Resolver
}

// Name implements Enricher.
func (TenantEnricher) Name() string { return "tenant" }

// Enrich implements Enricher.
func (e TenantEnricher) Enrich(ctx context.Context, span *spanmodel.Span) error {
	// The tenant label is client-controlled and reaches ClickHouse verbatim, so
	// it is sanitised whether or not a Resolver is configured.
	span.TenantID = sanitizeIdentifier(span.TenantID, maxTenantIDBytes)
	if e.Resolver == nil || span.TenantID == "" {
		return nil
	}
	tenantID, err := e.Resolver.Resolve(ctx, span.TenantID)
	if err != nil {
		return customerrors.TransientWrap(
			customerrors.ErrTenantLookupFailed,
			"failed to resolve tenant",
			err,
			true,
		)
	}
	span.TenantID = tenantID
	return nil
}

// ---------------------------------------------------------------------------
// PricingEnricher — computes USD cost from token counts.
// ---------------------------------------------------------------------------

// PricingEnricher sets span.CostUSD from token usage via the Resolver. A missing
// price is non-fatal: the cost is recorded as 0 rather than dropping the span,
// matching the OSS pricing policy.
//
// A cost the instrumentation reported itself (gen_ai.usage.cost) is ignored
// unless TrustReportedCost is set. The OTLP ports are unauthenticated, so an
// unconditionally trusted client cost lets anyone who can reach the collector
// declare a span worth $1,000,000 and have it stored verbatim — and every cost
// figure in the product is a sum(cost_usd). Operators whose instrumentation
// prices calls the table cannot (private or self-hosted models) can opt in.
type PricingEnricher struct {
	Resolver          pricing.Resolver
	TrustReportedCost bool
}

// Name implements Enricher.
func (PricingEnricher) Name() string { return "pricing" }

// Enrich implements Enricher.
func (e PricingEnricher) Enrich(ctx context.Context, span *spanmodel.Span) error {
	// Prefer a cost the instrumentation already computed (e.g. gen_ai.usage.cost)
	// only where the operator has declared that source trustworthy.
	if e.TrustReportedCost && span.ReportedCostUSD > 0 {
		span.CostUSD = span.ReportedCostUSD
		return nil
	}
	if e.Resolver == nil || span.ModelNormalized == "" {
		return nil
	}
	cost, err := e.Resolver.Resolve(ctx, span.ModelNormalized, pricing.Usage{
		Input:         span.InputTokens,
		Output:        span.OutputTokens,
		CacheRead:     span.CacheReadTokens,
		CacheCreation: span.CacheWriteTokens,
	})
	if err != nil {
		span.CostUSD = 0
		return nil
	}
	span.CostUSD = cost
	return nil
}

// ---------------------------------------------------------------------------
// FilterEnricher — drops spans whose model is not in the allow-list.
// ---------------------------------------------------------------------------

// FilterEnricher discards spans from models outside allowedModels. An empty
// allow-list permits every model.
type FilterEnricher struct {
	allowedModels map[string]bool
}

// NewFilterEnricher builds a FilterEnricher. Pass nil/empty to allow all models.
func NewFilterEnricher(models []string) FilterEnricher {
	m := make(map[string]bool, len(models))
	for _, name := range models {
		m[name] = true
	}
	return FilterEnricher{allowedModels: m}
}

// Name implements Enricher.
func (FilterEnricher) Name() string { return "filter" }

// Enrich implements Enricher.
func (f FilterEnricher) Enrich(_ context.Context, span *spanmodel.Span) error {
	if len(f.allowedModels) == 0 {
		return nil
	}
	model := span.ModelNormalized
	if model == "" {
		model = span.Model
	}
	if !f.allowedModels[model] {
		return customerrors.InvalidSpanf(
			customerrors.ErrUnknownModel,
			"model %q is not in the allowed list",
			model,
		)
	}
	return nil
}

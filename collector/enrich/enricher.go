// Package enrich holds Tracium's domain-specific span enrichment logic,
// deliberately kept free of any OpenTelemetry Collector framework imports.
//
// This is the open-core seam. The generic collector plumbing (receiving OTLP,
// batching, retry/queue, exporting) lives in upstream OTel components; the only
// Tracium-specific behaviour is expressed here as a chain of Enrichers that
// operate on the plain spanmodel.Span struct.
//
//   - The OSS edition registers DefaultEnrichers (see enrichers.go).
//   - The Enterprise edition registers the same chain plus its own Enrichers
//     (dynamic pricing, multi-user resolution, quotas, …) behind this same
//     interface — no fork of the plumbing required.
//
// Because nothing here depends on the collector framework, the whole package
// compiles and is unit-tested without network access; the framework adapter
// lives in processor/traciumprocessor.
package enrich

import (
	"context"

	customerrors "github.com/tracium/collector/internal/errors"
	"github.com/tracium/collector/pkg/spanmodel"
)

// Enricher is a single span-transformation step. Implementations must be safe
// for concurrent use, as the collector invokes them from multiple goroutines.
//
// Error contract (interpreted by Chain.Apply and the processor):
//   - nil                                 → span continues to the next Enricher
//   - *errors.SpanError                   → span is permanently invalid; drop it
//   - *errors.TransientError (retryable)  → propagated so the collector retries
//   - *errors.TransientError (!retryable) → span is dropped
//
// Never return a bare fmt.Errorf; wrap it via the errors package so the caller
// can classify it.
type Enricher interface {
	// Enrich transforms or validates the span in place.
	Enrich(ctx context.Context, span *spanmodel.Span) error
	// Name is a short, stable identifier used in logs and metrics.
	Name() string
}

// Chain runs an ordered list of Enrichers against a span.
type Chain struct {
	enrichers []Enricher
}

// NewChain builds a Chain from the given enrichers, run in the order supplied.
func NewChain(enrichers ...Enricher) *Chain {
	return &Chain{enrichers: enrichers}
}

// Enrichers returns the underlying enrichers in execution order. Useful for the
// Enterprise edition to compose on top of the OSS defaults.
func (c *Chain) Enrichers() []Enricher { return c.enrichers }

// Result reports what Apply decided to do with a span.
type Result int

const (
	// ResultKeep means the span was enriched successfully and should be exported.
	ResultKeep Result = iota
	// ResultDrop means the span was permanently invalid or filtered out.
	ResultDrop
)

// Apply runs every enricher in order.
//
// It returns (ResultDrop, nil) when an enricher reports a permanent SpanError or
// a non-retryable transient error — the caller should discard the span without
// failing the batch. It returns (ResultKeep, err) for a retryable transient
// error so the caller can let the collector's retry queue handle it. Otherwise
// it returns (ResultKeep, nil).
func (c *Chain) Apply(ctx context.Context, span *spanmodel.Span) (Result, error) {
	for _, e := range c.enrichers {
		err := e.Enrich(ctx, span)
		if err == nil {
			continue
		}
		switch {
		case customerrors.IsSpanError(err):
			// Permanent, span-level problem — drop it.
			return ResultDrop, nil
		case customerrors.IsTransient(err) && !customerrors.IsRetryable(err):
			// Temporary but not worth retrying — drop it.
			return ResultDrop, nil
		default:
			// Retryable transient (or unknown) — surface for the retry queue.
			return ResultKeep, err
		}
	}
	return ResultKeep, nil
}

// Package deadletter is the sink for spans the pipeline permanently rejects.
//
// Rule 1: a span that fails with a *errors.SpanError is never silently dropped.
// It is written here with its error code attached, so the loss is auditable and
// — depending on the implementation — recoverable. The Store is injected, so
// the pipeline never knows which implementation it has.
//
// Like the enrich package, this is deliberately free of OpenTelemetry Collector
// imports, so it can be used and unit-tested without the framework.
package deadletter

import (
	"context"

	"github.com/tracium/collector/pkg/spanmodel"
)

// Record is one rejected span together with why it was rejected.
type Record struct {
	// Code is the typed error code that caused the drop, e.g. "missing_trace_id".
	Code string
	// Reason is the human-readable error text.
	Reason string
	// Span is the span as far as it had been processed when it was rejected.
	Span *spanmodel.Span
}

// Store persists rejected spans. Implementations must be safe for concurrent
// use — the collector processes batches from several goroutines.
//
// Put returns an error only when the sink itself is unusable (e.g. the file
// cannot be written). A bad record is never an error: the span is already lost,
// and failing the batch would turn one bad span into a retry storm.
type Store interface {
	Put(ctx context.Context, rec Record) error
	Close() error
}

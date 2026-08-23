package writer

import (
	"context"

	"github.com/tracium/collector/pkg/spanmodel"
)

// Writer persists a batch of spans to durable storage.
// All implementations must be safe for concurrent use.
type Writer interface {
	// WriteBatch persists all spans in the batch atomically (best-effort).
	// Implementations should return a TransientError when the storage backend
	// is temporarily unavailable.
	WriteBatch(ctx context.Context, spans []*spanmodel.Span) error

	// Close flushes any pending spans and releases resources.
	Close() error
}

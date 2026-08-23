package deadletter

import (
	"context"
	"log/slog"
)

// Logger is the minimal logging surface LogStore needs. *slog.Logger satisfies
// it as-is; a host using another framework (the collector uses zap) wraps its
// own logger in a small adapter rather than this package importing that
// framework.
type Logger interface {
	Warn(msg string, args ...any)
}

// LogStore records rejected spans on a Logger. It is the default store: it
// makes every drop visible and alertable with no operator configuration. It
// does not make the span recoverable — configure a FileStore for that.
type LogStore struct {
	logger Logger
}

// NewLogStore returns a LogStore writing to logger, or to slog.Default() when
// logger is nil.
func NewLogStore(logger Logger) *LogStore {
	if logger == nil {
		logger = slog.Default()
	}
	return &LogStore{logger: logger}
}

// Put implements Store.
func (s *LogStore) Put(_ context.Context, rec Record) error {
	args := []any{"code", rec.Code, "reason", rec.Reason}
	if rec.Span != nil {
		args = append(args,
			"trace_id", rec.Span.TraceID,
			"span_id", rec.Span.SpanID,
			"model", rec.Span.Model,
		)
	}
	s.logger.Warn("span dead-lettered", args...)
	return nil
}

// Close implements Store. A logger owns no resources here.
func (s *LogStore) Close() error { return nil }

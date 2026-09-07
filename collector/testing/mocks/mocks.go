package mocks

import (
	"context"
	"sync"

	"github.com/tracium/collector/internal/deadletter"
	"github.com/tracium/collector/internal/pricing"
	"github.com/tracium/collector/pkg/spanmodel"
)

// ---------------------------------------------------------------------------
// Writer interface (local copy to avoid import cycle with internal/writer)
// ---------------------------------------------------------------------------

// Writer mirrors internal/writer.Writer for use in tests.
type Writer interface {
	WriteBatch(ctx context.Context, spans []*spanmodel.Span) error
	Close() error
}

// ---------------------------------------------------------------------------
// MockWriter
// ---------------------------------------------------------------------------

// MockWriter records all spans passed to WriteBatch.
type MockWriter struct {
	mu           sync.Mutex
	WrittenSpans []*spanmodel.Span
	WriteErr     error
}

// WriteBatch appends spans to WrittenSpans unless WriteErr is set.
func (m *MockWriter) WriteBatch(_ context.Context, spans []*spanmodel.Span) error {
	if m.WriteErr != nil {
		return m.WriteErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.WrittenSpans = append(m.WrittenSpans, spans...)
	return nil
}

// Close is a no-op.
func (m *MockWriter) Close() error { return nil }

// ---------------------------------------------------------------------------
// MockPricingResolver
// ---------------------------------------------------------------------------

// PricingResolver mirrors internal/pricing.Resolver for use in tests.
type PricingResolver interface {
	Resolve(ctx context.Context, model string, usage pricing.Usage) (float64, error)
}

// MockPricingResolver always returns FixedCost (unless ResolveErr is set).
type MockPricingResolver struct {
	FixedCost  float64
	ResolveErr error
}

// Resolve returns FixedCost or ResolveErr.
func (m *MockPricingResolver) Resolve(_ context.Context, _ string, _ pricing.Usage) (float64, error) {
	if m.ResolveErr != nil {
		return 0, m.ResolveErr
	}
	return m.FixedCost, nil
}

// ---------------------------------------------------------------------------
// MockUserResolver
// ---------------------------------------------------------------------------

// UserResolver mirrors internal/user.Resolver for use in tests.
type UserResolver interface {
	Resolve(ctx context.Context, apiKey string) (string, error)
}

// MockUserResolver always returns UserID (unless ResolveErr is set).
type MockUserResolver struct {
	UserID   string
	ResolveErr error
}

// Resolve returns UserID or ResolveErr.
func (m *MockUserResolver) Resolve(_ context.Context, _ string) (string, error) {
	if m.ResolveErr != nil {
		return "", m.ResolveErr
	}
	return m.UserID, nil
}

// ---------------------------------------------------------------------------
// MockEnricher
// ---------------------------------------------------------------------------

// MockEnricher records calls and can inject errors or delegate to EnrichFn.
// It satisfies enrich.Enricher for use in tests.
type MockEnricher struct {
	EnricherName string
	EnrichErr    error
	EnrichFn     func(*spanmodel.Span) error

	mu        sync.Mutex
	CallCount int
}

// Name returns EnricherName.
func (m *MockEnricher) Name() string { return m.EnricherName }

// Enrich increments CallCount, then delegates to EnrichFn or returns EnrichErr.
func (m *MockEnricher) Enrich(_ context.Context, span *spanmodel.Span) error {
	m.mu.Lock()
	m.CallCount++
	m.mu.Unlock()

	if m.EnrichFn != nil {
		return m.EnrichFn(span)
	}
	return m.EnrichErr
}

// ---------------------------------------------------------------------------
// MockDeadLetterStore
// ---------------------------------------------------------------------------

// MockDeadLetterStore records every dead-lettered span. It satisfies
// deadletter.Store for use in tests.
type MockDeadLetterStore struct {
	mu       sync.Mutex
	Records  []deadletter.Record
	PutErr   error
	CloseErr error
	Closed   bool
}

// Put appends rec to Records, or returns PutErr when set.
func (m *MockDeadLetterStore) Put(_ context.Context, rec deadletter.Record) error {
	if m.PutErr != nil {
		return m.PutErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Records = append(m.Records, rec)
	return nil
}

// Close marks the store closed and returns CloseErr.
func (m *MockDeadLetterStore) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Closed = true
	return m.CloseErr
}

// Count returns how many records were dead-lettered.
func (m *MockDeadLetterStore) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.Records)
}

// Codes returns the error code of each dead-lettered record, in order.
func (m *MockDeadLetterStore) Codes() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	codes := make([]string, len(m.Records))
	for i, r := range m.Records {
		codes[i] = r.Code
	}
	return codes
}

// ---------------------------------------------------------------------------
// NewTestSpan
// ---------------------------------------------------------------------------

// NewTestSpan returns a minimal valid span suitable for use in unit tests.
func NewTestSpan() *spanmodel.Span {
	return &spanmodel.Span{
		TraceID:         "trace-abc-123",
		SpanID:          "span-def-456",
		ParentSpanID:    "",
		Name:            "openai.chat.completion",
		StartTimeMs:     1_700_000_000_000,
		EndTimeMs:       1_700_000_001_500,
		DurationMs:      1500,
		Model:           "gpt-4o",
		ModelNormalized: "gpt-4o",
		InputTokens:     100,
		OutputTokens:    50,
		FinishReason:    "stop",
		CostUSD:         0.0,
		UserID:        "user-test-1",
		SchemaVersion:   1,
	}
}

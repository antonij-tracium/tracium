package mocks

import (
	"context"
	"fmt"

	"github.com/tracium/api/internal/model"
	"github.com/tracium/api/internal/query"
)

// MockTraceRepository is an in-memory implementation of query.TraceRepository
// for use in handler unit tests. It never touches a real database.
type MockTraceRepository struct {
	Traces   []model.Trace
	SpansMap map[string][]model.Span

	// Configurable errors — set these to simulate failures.
	ListErr  error
	GetErr   error
	SpanErr  error

	// Call counters — inspect these in tests.
	ListCallCount int
	GetCallCount  int
	SpanCallCount int
}

// NewMockTraceRepository constructs an empty MockTraceRepository.
func NewMockTraceRepository() *MockTraceRepository {
	return &MockTraceRepository{
		SpansMap: make(map[string][]model.Span),
	}
}

// AddTrace adds a trace (and its spans) to the mock store.
func (m *MockTraceRepository) AddTrace(trace model.Trace, spans []model.Span) {
	m.Traces = append(m.Traces, trace)
	m.SpansMap[trace.TraceID] = spans
}

// ListTraces returns all stored traces that match the filter's TenantID, along
// with the total number of matches. The mock does not paginate, so the total
// equals the number of returned traces.
func (m *MockTraceRepository) ListTraces(_ context.Context, filter query.TraceFilter) ([]model.Trace, int64, error) {
	m.ListCallCount++
	if m.ListErr != nil {
		return nil, 0, m.ListErr
	}

	var result []model.Trace
	for _, t := range m.Traces {
		if t.TenantID == filter.TenantID {
			result = append(result, t)
		}
	}
	return result, int64(len(result)), nil
}

// GetTrace returns the trace with the given ID, or ErrNotFound.
func (m *MockTraceRepository) GetTrace(_ context.Context, traceID string) (*model.Trace, error) {
	m.GetCallCount++
	if m.GetErr != nil {
		return nil, m.GetErr
	}

	for _, t := range m.Traces {
		if t.TraceID == traceID {
			cp := t
			return &cp, nil
		}
	}
	return nil, query.ErrNotFound
}

// GetSpans returns all spans for the given trace ID, or ErrNotFound.
func (m *MockTraceRepository) GetSpans(_ context.Context, traceID string) ([]model.Span, error) {
	m.SpanCallCount++
	if m.SpanErr != nil {
		return nil, m.SpanErr
	}

	spans, ok := m.SpansMap[traceID]
	if !ok {
		return nil, query.ErrNotFound
	}
	return spans, nil
}

// MockMetricsRepository is an in-memory query.MetricsRepository for handler
// tests. Each method returns its preset field (and the shared Err), so tests
// can assert serialization without a database.
type MockMetricsRepository struct {
	KPIs          model.KPISet
	Cost          []model.CostPoint
	Latency       []model.LatencyPoint
	Errors        []model.ErrorPoint
	Agents        []model.AgentCost
	AgentRows     []model.Agent
	AgentDetailV  model.AgentDetail
	FailureItems  []model.Failure
	FailuresTotal int64
	Models        []model.ModelCost
	Tenants       []model.TenantUsage
	AgentUsages   []model.AgentUsage

	Err error
}

func (m *MockMetricsRepository) OverviewKPIs(_ context.Context, _ query.MetricsFilter) (model.KPISet, error) {
	return m.KPIs, m.Err
}

func (m *MockMetricsRepository) CostSeries(_ context.Context, _ query.MetricsFilter) ([]model.CostPoint, error) {
	return m.Cost, m.Err
}

func (m *MockMetricsRepository) LatencySeries(_ context.Context, _ query.MetricsFilter) ([]model.LatencyPoint, error) {
	return m.Latency, m.Err
}

func (m *MockMetricsRepository) ErrorSeries(_ context.Context, _ query.MetricsFilter) ([]model.ErrorPoint, error) {
	return m.Errors, m.Err
}

func (m *MockMetricsRepository) TopAgents(_ context.Context, _ query.MetricsFilter, _ int) ([]model.AgentCost, error) {
	return m.Agents, m.Err
}

func (m *MockMetricsRepository) ListAgents(_ context.Context, _ query.MetricsFilter, _ int) ([]model.Agent, error) {
	return m.AgentRows, m.Err
}

func (m *MockMetricsRepository) AgentDetail(_ context.Context, _ query.MetricsFilter) (model.AgentDetail, error) {
	return m.AgentDetailV, m.Err
}

func (m *MockMetricsRepository) Failures(_ context.Context, _ query.MetricsFilter, _ int) ([]model.Failure, int64, error) {
	return m.FailureItems, m.FailuresTotal, m.Err
}

func (m *MockMetricsRepository) ModelCosts(_ context.Context, _ query.MetricsFilter, _ int) ([]model.ModelCost, error) {
	return m.Models, m.Err
}

func (m *MockMetricsRepository) TenantUsage(_ context.Context, _ query.MetricsFilter, _ int) ([]model.TenantUsage, error) {
	return m.Tenants, m.Err
}

func (m *MockMetricsRepository) AgentUsage(_ context.Context, _ query.MetricsFilter, _ int) ([]model.AgentUsage, error) {
	return m.AgentUsages, m.Err
}

// NewTestTrace returns a pre-populated Trace fixture for use in tests.
func NewTestTrace() model.Trace {
	return model.Trace{
		TraceID:      "trace-test-001",
		Name:         "test-trace",
		StartTimeMs:  1_700_000_000_000,
		EndTimeMs:    1_700_000_001_000,
		DurationMs:   1000,
		TenantID:     "tenant-test",
		SpanCount:    2,
		HasError:     false,
		TotalCostUSD: 0.0012,
	}
}

// NewTestSpan returns a pre-populated Span fixture for use in tests.
func NewTestSpan() model.Span {
	return model.Span{
		TraceID:         "trace-test-001",
		SpanID:          fmt.Sprintf("span-%d", 1),
		ParentSpanID:    "",
		Name:            "llm.chat",
		StartTimeMs:     1_700_000_000_000,
		EndTimeMs:       1_700_000_001_000,
		DurationMs:      1000,
		Model:           "gpt-4o",
		FinishReason:    "stop",
		InputTokens:     500,
		OutputTokens:    150,
		CostUSD:         0.0012,
		TenantID:        "tenant-test",
		ModelNormalized: "openai/gpt-4o",
		SchemaVersion:   1,
		ErrorType:       "",
		ErrorMessage:    "",
	}
}

// NewTestPrincipal returns a Principal fixture for injecting into handler tests.
func NewTestPrincipal(tenantID string) *model.Principal {
	return &model.Principal{
		TenantID: tenantID,
		Role:     "admin",
	}
}

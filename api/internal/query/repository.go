package query

import (
	"context"
	"errors"

	"github.com/tracium/api/internal/model"
)

// TraceRepository is the primary data access interface for the API.
// All handlers depend on this interface, never on a concrete database type.
type TraceRepository interface {
	ListTraces(ctx context.Context, filter TraceFilter) ([]model.Trace, int64, error)
	GetTrace(ctx context.Context, traceID string) (*model.Trace, error)
	GetSpans(ctx context.Context, traceID string) ([]model.Span, error)
}

// MetricsRepository serves the aggregated metrics powering the dashboard
// overview. Like TraceRepository, handlers depend only on this interface.
type MetricsRepository interface {
	OverviewKPIs(ctx context.Context, f MetricsFilter) (model.KPISet, error)
	CostSeries(ctx context.Context, f MetricsFilter) ([]model.CostPoint, error)
	LatencySeries(ctx context.Context, f MetricsFilter) ([]model.LatencyPoint, error)
	ErrorSeries(ctx context.Context, f MetricsFilter) ([]model.ErrorPoint, error)
	TopAgents(ctx context.Context, f MetricsFilter, limit int) ([]model.AgentCost, error)
	ListAgents(ctx context.Context, f MetricsFilter, limit int) ([]model.Agent, error)
	// AgentDetail serves one agent's detail page (f.Agent names it). Returns
	// ErrNotFound when that agent has no runs in the window.
	AgentDetail(ctx context.Context, f MetricsFilter) (model.AgentDetail, error)
	Failures(ctx context.Context, f MetricsFilter, limit int) ([]model.Failure, int64, error)
	ModelCosts(ctx context.Context, f MetricsFilter, limit int) ([]model.ModelCost, error)
	TenantUsage(ctx context.Context, f MetricsFilter, limit int) ([]model.TenantUsage, error)
	AgentUsage(ctx context.Context, f MetricsFilter, limit int) ([]model.AgentUsage, error)
}

// Repository is the full data-access surface a backend must provide. Concrete
// stores (ClickHouse, the no-op stub) implement it; handlers depend only on the
// narrower TraceRepository / MetricsRepository interfaces.
type Repository interface {
	TraceRepository
	MetricsRepository
}

// ErrNotFound is the sentinel error returned when a requested resource does not exist.
// Handlers check for this specifically to return 404 vs 500.
var ErrNotFound = errors.New("not found")

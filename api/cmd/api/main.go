package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/joho/godotenv"

	"github.com/tracium/api/internal/auth"
	"github.com/tracium/api/internal/config"
	"github.com/tracium/api/internal/handler"
	"github.com/tracium/api/internal/middleware"
	"github.com/tracium/api/internal/model"
	"github.com/tracium/api/internal/query"
	"github.com/tracium/api/internal/workspace"
	"github.com/tracium/api/internal/version"
)

func main() {
	// ── Config ────────────────────────────────────────────────────────────────

	// Load a local .env for native dev runs. Real environment variables (e.g. from
	// docker-compose) always take precedence; a missing file is not an error.
	_ = godotenv.Load()

	configPath := os.Getenv("CONFIG_FILE")
	cfg, err := config.Load(configPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}
	cfg.Default()
	cfg.ApplyEnv() // env vars (CLICKHOUSE_DSN, LISTEN_ADDR, etc.) override the config file
	if err := cfg.Validate(); err != nil {
		log.Fatalf("invalid config: %v", err)
	}

	// ── Repository ────────────────────────────────────────────────────────────

	var repo query.Repository

	if cfg.Storage.ClickHouseDSN != "" {
		chRepo, err := query.NewClickHouseRepository(cfg.Storage.ClickHouseDSN)
		if err != nil {
			log.Fatalf("failed to connect to ClickHouse: %v", err)
		}
		repo = chRepo
		log.Println("connected to ClickHouse")
	} else {
		log.Println("WARNING: no ClickHouse DSN configured — repository calls will return ErrNotFound")
		// Use a no-op stub so the server still starts up and health endpoints work.
		repo = &noopRepository{}
	}

	// ── Auth ──────────────────────────────────────────────────────────────────

	// Accounts are persisted in Postgres, whose DSN is required config — auth is
	// never disabled by a missing value.
	userStore, err := auth.NewUserStore(context.Background(), cfg.Storage.PostgresDSN)
	if err != nil {
		log.Fatalf("failed to connect to Postgres: %v", err)
	}
	authService := auth.NewService(userStore, auth.NewTokenIssuer(cfg.Auth.JWTSecret))
	authHandler := handler.NewAuthHandler(authService)

	wsStore, err := workspace.NewStore(context.Background(), cfg.Storage.PostgresDSN)
	if err != nil {
		log.Fatalf("failed to init workspace store: %v", err)
	}
	workspaceHandler := handler.NewWorkspaceHandler(wsStore)

	// The auth strategy is chosen explicitly by config. AuthModeNone has to be
	// asked for by name; it is never the fallback for something absent.
	var authenticator middleware.Authenticator = authService.Authenticator()
	if cfg.Auth.Mode == config.AuthModeNone {
		log.Println("WARNING: auth.mode=none — every request is granted the admin role; never use this outside local development")
		authenticator = &middleware.NoopAuthenticator{}
	} else {
		log.Println("connected to Postgres — auth enabled")
	}

	// ── Handlers ─────────────────────────────────────────────────────────────

	traceHandler := handler.NewTraceHandler(repo)
	spanHandler := handler.NewSpanHandler(repo)
	metricsHandler := handler.NewMetricsHandler(repo)
	healthHandler := handler.NewHealthHandler()

	// ── Router ────────────────────────────────────────────────────────────────

	r := chi.NewRouter()

	// Global middleware chain — order matters; do not reorder.
	r.Use(middleware.CORS())
	r.Use(middleware.APIVersion(version.V1))

	// Health and readiness probes are unauthenticated.
	r.Get(version.Route(version.V1, "/health"), healthHandler.Health)
	r.Get(version.Route(version.V1, "/ready"), healthHandler.Ready)

	// Account registration and login are unauthenticated.
	r.Post(version.Route(version.V1, "/auth/register"), authHandler.Register)
	r.Post(version.Route(version.V1, "/auth/login"), authHandler.Login)

	// Workspace routes — auth only (no tenant required; workspaces are per-user).
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(authenticator))
		r.Get(version.Route(version.V1, "/workspaces"), workspaceHandler.List)
		r.Post(version.Route(version.V1, "/workspaces"), workspaceHandler.Create)
		r.Delete(version.Route(version.V1, "/workspaces/{id}"), workspaceHandler.Delete)
	})

	// Authenticated routes.
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(authenticator))
		r.Use(middleware.RequireTenant())

		r.Get(version.Route(version.V1, "/traces"), traceHandler.ListTraces)
		r.Get(version.Route(version.V1, "/traces/{id}"), traceHandler.GetTrace)
		r.Get(version.Route(version.V1, "/traces/{traceId}/spans"), spanHandler.ListSpans)

		r.Get(version.Route(version.V1, "/metrics/kpis"), metricsHandler.KPIs)
		r.Get(version.Route(version.V1, "/metrics/cost-series"), metricsHandler.CostSeries)
		r.Get(version.Route(version.V1, "/metrics/latency-series"), metricsHandler.LatencySeries)
		r.Get(version.Route(version.V1, "/metrics/error-series"), metricsHandler.ErrorSeries)
		r.Get(version.Route(version.V1, "/metrics/top-agents"), metricsHandler.TopAgents)
		r.Get(version.Route(version.V1, "/metrics/agents"), metricsHandler.Agents)
		r.Get(version.Route(version.V1, "/metrics/agents/{name}"), metricsHandler.AgentDetail)
		r.Get(version.Route(version.V1, "/metrics/failures"), metricsHandler.Failures)
		r.Get(version.Route(version.V1, "/metrics/model-costs"), metricsHandler.ModelCosts)
		r.Get(version.Route(version.V1, "/metrics/usage-tenants"), metricsHandler.TenantUsage)
		r.Get(version.Route(version.V1, "/metrics/usage-agents"), metricsHandler.AgentUsage)
	})

	// ── HTTP Server ───────────────────────────────────────────────────────────

	srv := &http.Server{
		Addr:         cfg.Server.Addr,
		Handler:      r,
		ReadTimeout:  time.Duration(cfg.Server.ReadTimeoutSeconds) * time.Second,
		WriteTimeout: time.Duration(cfg.Server.WriteTimeoutSeconds) * time.Second,
	}

	// Start server in background.
	go func() {
		log.Printf("tracium-api listening on %s", cfg.Server.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	// ── Graceful Shutdown ─────────────────────────────────────────────────────

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("graceful shutdown failed: %v", err)
	}
	log.Println("server stopped")
}

// noopRepository is used when no ClickHouse DSN is configured.
// It satisfies the TraceRepository interface and returns ErrNotFound for every call.
type noopRepository struct{}

func (n *noopRepository) ListTraces(_ context.Context, _ query.TraceFilter) ([]model.Trace, int64, error) {
	return nil, 0, query.ErrNotFound
}

func (n *noopRepository) GetTrace(_ context.Context, _ string) (*model.Trace, error) {
	return nil, query.ErrNotFound
}

func (n *noopRepository) GetSpans(_ context.Context, _ string) ([]model.Span, error) {
	return nil, query.ErrNotFound
}

// Metrics calls return empty results (not ErrNotFound) so the overview renders
// its own empty state rather than a 500 when no ClickHouse is configured.

func (n *noopRepository) OverviewKPIs(_ context.Context, _ query.MetricsFilter) (model.KPISet, error) {
	return model.KPISet{}, nil
}

func (n *noopRepository) CostSeries(_ context.Context, _ query.MetricsFilter) ([]model.CostPoint, error) {
	return nil, nil
}

func (n *noopRepository) LatencySeries(_ context.Context, _ query.MetricsFilter) ([]model.LatencyPoint, error) {
	return nil, nil
}

func (n *noopRepository) ErrorSeries(_ context.Context, _ query.MetricsFilter) ([]model.ErrorPoint, error) {
	return nil, nil
}

func (n *noopRepository) TopAgents(_ context.Context, _ query.MetricsFilter, _ int) ([]model.AgentCost, error) {
	return nil, nil
}

func (n *noopRepository) ListAgents(_ context.Context, _ query.MetricsFilter, _ int) ([]model.Agent, error) {
	return nil, nil
}

func (n *noopRepository) AgentDetail(_ context.Context, _ query.MetricsFilter) (model.AgentDetail, error) {
	return model.AgentDetail{}, query.ErrNotFound
}

func (n *noopRepository) Failures(_ context.Context, _ query.MetricsFilter, _ int) ([]model.Failure, int64, error) {
	return nil, 0, nil
}

func (n *noopRepository) ModelCosts(_ context.Context, _ query.MetricsFilter, _ int) ([]model.ModelCost, error) {
	return nil, nil
}

func (n *noopRepository) TenantUsage(_ context.Context, _ query.MetricsFilter, _ int) ([]model.TenantUsage, error) {
	return nil, nil
}

func (n *noopRepository) AgentUsage(_ context.Context, _ query.MetricsFilter, _ int) ([]model.AgentUsage, error) {
	return nil, nil
}

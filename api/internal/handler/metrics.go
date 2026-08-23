package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/tracium/api/internal/query"
)

// overviewLimit caps the rows returned by the top-agents and failures lists —
// the overview shows five of each.
const overviewLimit = 5

// usageLimit caps the rows returned by the usage-page breakdown lists (models,
// tenants, agents), which show more rows than the overview's top-five.
const usageLimit = 50

// agentsLimit caps the rows returned by the Agents page, which lists every
// active agent (sorted/filtered client-side) rather than a top-N slice.
const agentsLimit = 200

// MetricsHandler serves the aggregated metrics powering the dashboard overview.
type MetricsHandler struct {
	repo query.MetricsRepository
	now  func() time.Time // injectable clock; defaults to time.Now
}

// NewMetricsHandler constructs a MetricsHandler with the given repository.
func NewMetricsHandler(repo query.MetricsRepository) *MetricsHandler {
	return &MetricsHandler{repo: repo, now: time.Now}
}

// filter resolves the shared range + tenant_id query params into a MetricsFilter,
// writing a 400 and returning ok=false on a bad range.
func (h *MetricsHandler) filter(w http.ResponseWriter, r *http.Request) (query.MetricsFilter, bool) {
	rng := r.URL.Query().Get("range")
	if rng == "" {
		rng = "7d"
	}
	f, err := query.ParseRange(rng, h.now())
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return query.MetricsFilter{}, false
	}
	// tenant_id is an optional business filter (the operator's end-client), not
	// an access boundary — same semantics as ListTraces.
	f.TenantID = r.URL.Query().Get("tenant_id")

	// agent narrows the series to one derived agent (the detail page's charts).
	// Agent-scoped metrics are a raw-window feature: per-agent latency can't come
	// from the daily rollup, so reject ranges that would use it rather than
	// silently returning all-agent data.
	f.Agent = r.URL.Query().Get("agent")
	if f.Agent != "" && f.UseRollup() {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "agent filtering is available for ranges up to 30d")
		return query.MetricsFilter{}, false
	}
	return f, true
}

// KPIs handles GET /v1/metrics/kpis.
func (h *MetricsHandler) KPIs(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	kpis, err := h.repo.OverviewKPIs(r.Context(), f)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to compute kpis")
		return
	}
	respondJSON(w, http.StatusOK, kpis)
}

// CostSeries handles GET /v1/metrics/cost-series.
func (h *MetricsHandler) CostSeries(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	points, err := h.repo.CostSeries(r.Context(), f)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load cost series")
		return
	}
	respondPage(w, points, len(points), 1, len(points))
}

// LatencySeries handles GET /v1/metrics/latency-series.
func (h *MetricsHandler) LatencySeries(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	points, err := h.repo.LatencySeries(r.Context(), f)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load latency series")
		return
	}
	respondPage(w, points, len(points), 1, len(points))
}

// ErrorSeries handles GET /v1/metrics/error-series.
func (h *MetricsHandler) ErrorSeries(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	points, err := h.repo.ErrorSeries(r.Context(), f)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load error series")
		return
	}
	respondPage(w, points, len(points), 1, len(points))
}

// TopAgents handles GET /v1/metrics/top-agents.
func (h *MetricsHandler) TopAgents(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	agents, err := h.repo.TopAgents(r.Context(), f, overviewLimit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load top agents")
		return
	}
	respondPage(w, agents, len(agents), 1, len(agents))
}

// Agents handles GET /v1/metrics/agents — the Agents page's full activity list.
func (h *MetricsHandler) Agents(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	agents, err := h.repo.ListAgents(r.Context(), f, agentsLimit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load agents")
		return
	}
	respondPage(w, agents, len(agents), 1, len(agents))
}

// AgentDetail handles GET /v1/metrics/agents/{name} — one agent's detail page
// payload. The agent name comes from the path, so the shared filter()'s query
// param is irrelevant here; the rollup gate is re-checked once the path agent
// is set.
func (h *MetricsHandler) AgentDetail(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if name == "" {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "agent name is required")
		return
	}
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	f.Agent = name
	if f.UseRollup() {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "agent detail is available for ranges up to 30d")
		return
	}
	detail, err := h.repo.AgentDetail(r.Context(), f)
	if err != nil {
		if errors.Is(err, query.ErrNotFound) {
			respondError(w, http.StatusNotFound, "AGENT_NOT_FOUND", "agent not found")
			return
		}
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load agent")
		return
	}
	respondJSON(w, http.StatusOK, detail)
}

// Failures handles GET /v1/metrics/failures. Total counts every failed run in
// the window, not just the listed agents.
func (h *MetricsHandler) Failures(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	failures, total, err := h.repo.Failures(r.Context(), f, overviewLimit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load failures")
		return
	}
	respondPage(w, failures, int(total), 1, len(failures))
}

// ModelCosts handles GET /v1/metrics/model-costs.
func (h *MetricsHandler) ModelCosts(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	models, err := h.repo.ModelCosts(r.Context(), f, usageLimit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load model costs")
		return
	}
	respondPage(w, models, len(models), 1, len(models))
}

// TenantUsage handles GET /v1/metrics/usage-tenants.
func (h *MetricsHandler) TenantUsage(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	tenants, err := h.repo.TenantUsage(r.Context(), f, usageLimit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load tenant usage")
		return
	}
	respondPage(w, tenants, len(tenants), 1, len(tenants))
}

// AgentUsage handles GET /v1/metrics/usage-agents.
func (h *MetricsHandler) AgentUsage(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	agents, err := h.repo.AgentUsage(r.Context(), f, usageLimit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load agent usage")
		return
	}
	respondPage(w, agents, len(agents), 1, len(agents))
}

package handler

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/tracium/api/internal/query"
)

// overviewLimit caps the rows returned by the top-workflows and failures lists —
// the overview shows five of each.
const overviewLimit = 5

// usageLimit caps the rows returned by the usage-page breakdown lists (models,
// users, workflows), which show more rows than the overview's top-five.
const usageLimit = 50

// workflowsLimit caps the rows returned by the Workflows page, which lists every
// active workflow (sorted/filtered client-side) rather than a top-N slice.
const workflowsLimit = 200

// MetricsHandler serves the aggregated metrics powering the dashboard overview.
type MetricsHandler struct {
	repo   query.MetricsRepository
	access WorkspaceAccess
	now    func() time.Time // injectable clock; defaults to time.Now
}

// NewMetricsHandler constructs a MetricsHandler with the given repository and
// workspace access resolver (used to scope every metric to the caller's
// workspaces).
func NewMetricsHandler(repo query.MetricsRepository, access WorkspaceAccess) *MetricsHandler {
	return &MetricsHandler{repo: repo, access: access, now: time.Now}
}

// filter resolves the shared range + user_id query params into a MetricsFilter,
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
	// user_id is an optional business filter (the operator's end-client), not
	// an access boundary — same semantics as ListTraces.
	f.UserID = r.URL.Query().Get("user_id")

	// Enforce workspace access: scope every metric to the workspaces the caller
	// may read (the selected one, if a valid workspace_id is passed, else all of
	// theirs). Refuses with 403 if they ask for a workspace they can't access.
	scope, ok := resolveWorkspaceScope(w, r, h.access, r.URL.Query().Get("workspace_id"))
	if !ok {
		return query.MetricsFilter{}, false
	}
	f.WorkspaceIDs = scope

	// workflow narrows the series to one derived workflow (the detail page's charts).
	// Workflow-scoped metrics are a raw-window feature: per-workflow latency can't come
	// from the daily rollup, so reject ranges that would use it rather than
	// silently returning all-workflow data.
	f.Workflow = r.URL.Query().Get("workflow")
	if f.Workflow != "" && f.UseRollup() {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "workflow filtering is available for ranges up to 30d")
		return query.MetricsFilter{}, false
	}
	return f, true
}

// validAnomalyMetrics / validAnomalySeverities gate the optional anomaly query
// params so a typo returns 400 rather than silently matching nothing.
var validAnomalyMetrics = map[string]bool{"cost": true, "error_rate": true, "runs": true}
var validAnomalySeverities = map[string]bool{"info": true, "warning": true, "critical": true}

// Anomalies handles GET /v1/metrics/anomalies. Detection is daily and served
// from the daily rollup, so it needs a range of 7d or longer (24h is
// sub-daily); the handler rejects shorter ranges. Optional `metric` and
// `min_severity` narrow the results.
func (h *MetricsHandler) Anomalies(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	// Detection is daily; a sub-daily bucket (the 24h range) cannot be scored.
	if f.Bucket < 24*time.Hour {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "anomaly detection requires a range of 7d or longer")
		return
	}
	if m := r.URL.Query().Get("metric"); m != "" {
		if !validAnomalyMetrics[m] {
			respondError(w, http.StatusBadRequest, "BAD_REQUEST", "metric must be one of cost, error_rate, runs")
			return
		}
		f.AnomalyMetric = m
	}
	if s := r.URL.Query().Get("min_severity"); s != "" {
		if !validAnomalySeverities[s] {
			respondError(w, http.StatusBadRequest, "BAD_REQUEST", "min_severity must be one of info, warning, critical")
			return
		}
		f.AnomalyMinSeverity = s
	}
	anomalies, err := h.repo.Anomalies(r.Context(), f)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to detect anomalies")
		return
	}
	respondPage(w, anomalies, len(anomalies), 1, len(anomalies))
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

// TopWorkflows handles GET /v1/metrics/top-workflows.
func (h *MetricsHandler) TopWorkflows(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	workflows, err := h.repo.TopWorkflows(r.Context(), f, overviewLimit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load top workflows")
		return
	}
	respondPage(w, workflows, len(workflows), 1, len(workflows))
}

// Workflows handles GET /v1/metrics/workflows — the Workflows page's full activity list.
func (h *MetricsHandler) Workflows(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	workflows, err := h.repo.ListWorkflows(r.Context(), f, workflowsLimit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load workflows")
		return
	}
	respondPage(w, workflows, len(workflows), 1, len(workflows))
}

// WorkflowDetail handles GET /v1/metrics/workflows/{name} — one workflow's detail page
// payload. The workflow name comes from the path, so the shared filter()'s query
// param is irrelevant here; the rollup gate is re-checked once the path workflow
// is set.
func (h *MetricsHandler) WorkflowDetail(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if name == "" {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "workflow name is required")
		return
	}
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	f.Workflow = name
	if f.UseRollup() {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "workflow detail is available for ranges up to 30d")
		return
	}
	detail, err := h.repo.WorkflowDetail(r.Context(), f)
	if err != nil {
		if errors.Is(err, query.ErrNotFound) {
			respondError(w, http.StatusNotFound, "WORKFLOW_NOT_FOUND", "workflow not found")
			return
		}
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load workflow")
		return
	}
	respondJSON(w, http.StatusOK, detail)
}

// Failures handles GET /v1/metrics/failures. Total counts every failed run in
// the window, not just the listed workflows.
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

// UserUsage handles GET /v1/metrics/usage-users.
func (h *MetricsHandler) UserUsage(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	users, err := h.repo.UserUsage(r.Context(), f, usageLimit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load user usage")
		return
	}
	respondPage(w, users, len(users), 1, len(users))
}

// WorkflowUsage handles GET /v1/metrics/usage-workflows.
func (h *MetricsHandler) WorkflowUsage(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	workflows, err := h.repo.WorkflowUsage(r.Context(), f, usageLimit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load workflow usage")
		return
	}
	respondPage(w, workflows, len(workflows), 1, len(workflows))
}

// AttributeKeys lists the custom-attribute dimensions available in the window,
// so the caller can offer them as allocation axes (team, user, environment, …).
func (h *MetricsHandler) AttributeKeys(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	keys, err := h.repo.AttributeKeys(r.Context(), f, workflowsLimit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load attribute keys")
		return
	}
	respondPage(w, keys, len(keys), 1, len(keys))
}

// UsageByAttribute allocates spend/usage across the values of one custom
// attribute — e.g. GET /v1/metrics/usage-by-attribute?key=team. The key is
// required; without it there is no dimension to group by.
func (h *MetricsHandler) UsageByAttribute(w http.ResponseWriter, r *http.Request) {
	f, ok := h.filter(w, r)
	if !ok {
		return
	}
	key := r.URL.Query().Get("key")
	if key == "" {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "the 'key' query parameter is required")
		return
	}
	usage, err := h.repo.UsageByAttribute(r.Context(), f, key, usageLimit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to load usage by attribute")
		return
	}
	respondPage(w, usage, len(usage), 1, len(usage))
}

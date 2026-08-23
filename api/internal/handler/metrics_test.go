package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/tracium/api/internal/model"
	"github.com/tracium/api/internal/query"
	"github.com/tracium/api/testing/mocks"
)

// agentDetailRequest builds a request carrying the {name} path param the way chi
// would, so AgentDetail's chi.URLParam("name") resolves in a unit test.
func agentDetailRequest(name, rawQuery string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/v1/metrics/agents/"+name+"?"+rawQuery, nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("name", name)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func TestMetricsKPIs(t *testing.T) {
	repo := &mocks.MockMetricsRepository{
		KPIs: model.KPISet{
			Cost: model.KPI{Value: 2.64, Delta: 0.12, DeltaType: "bad"},
			Runs: model.KPI{Value: 3751, Delta: 0.08, DeltaType: "good"},
		},
	}
	h := NewMetricsHandler(repo)

	rr := httptest.NewRecorder()
	h.KPIs(rr, httptest.NewRequest(http.MethodGet, "/v1/metrics/kpis?range=7d", nil))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got model.KPISet
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Cost.Value != 2.64 || got.Cost.DeltaType != "bad" {
		t.Errorf("cost KPI = %+v, want value 2.64 / bad", got.Cost)
	}
	if got.Runs.Value != 3751 {
		t.Errorf("runs value = %v, want 3751", got.Runs.Value)
	}
}

func TestMetricsErrorSeries(t *testing.T) {
	repo := &mocks.MockMetricsRepository{
		Errors: []model.ErrorPoint{
			{BucketMs: 1_700_000_000_000, Errors: 2, Total: 312},
			{BucketMs: 1_700_086_400_000, Errors: 8, Total: 298},
		},
	}
	h := NewMetricsHandler(repo)

	rr := httptest.NewRecorder()
	h.ErrorSeries(rr, httptest.NewRequest(http.MethodGet, "/v1/metrics/error-series?range=7d", nil))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got struct {
		Items []model.ErrorPoint `json:"items"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Items) != 2 || got.Items[1].Errors != 8 || got.Items[1].Total != 298 {
		t.Errorf("items = %+v, want two buckets ending in 8/298", got.Items)
	}
}

func TestMetricsAgentsEnvelope(t *testing.T) {
	repo := &mocks.MockMetricsRepository{
		AgentRows: []model.Agent{
			{Name: "classify-intent", Calls: 1203, Cost: 0.1204, AvgLatencyMs: 820, ErrorRate: 0.014, Trend: []int64{42, 48, 52}, LastTraceID: "tr_classify_999"},
		},
	}
	h := NewMetricsHandler(repo)

	rr := httptest.NewRecorder()
	h.Agents(rr, httptest.NewRequest(http.MethodGet, "/v1/metrics/agents?range=7d", nil))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got struct {
		Items []model.Agent `json:"items"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0].Name != "classify-intent" {
		t.Fatalf("items = %+v, want one classify-intent row", got.Items)
	}
	a := got.Items[0]
	if a.Calls != 1203 || a.AvgLatencyMs != 820 || a.ErrorRate != 0.014 || len(a.Trend) != 3 || a.LastTraceID != "tr_classify_999" {
		t.Errorf("agent row = %+v, want calls 1203 / latency 820 / err 0.014 / 3 trend points / last trace tr_classify_999", a)
	}
}

func TestMetricsTenantUsageEnvelope(t *testing.T) {
	repo := &mocks.MockMetricsRepository{
		Tenants: []model.TenantUsage{
			{TenantID: "tn_acme", Cost: 12.44, CostPrev: 10.88, Runs: 58022, RunsPrev: 53110, Trend: []float64{0.4, 0.5}},
		},
	}
	h := NewMetricsHandler(repo)

	rr := httptest.NewRecorder()
	h.TenantUsage(rr, httptest.NewRequest(http.MethodGet, "/v1/metrics/usage-tenants?range=30d", nil))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got struct {
		Items []model.TenantUsage `json:"items"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0].TenantID != "tn_acme" {
		t.Fatalf("items = %+v, want one tn_acme row", got.Items)
	}
	if got.Items[0].CostPrev != 10.88 || got.Items[0].RunsPrev != 53110 {
		t.Errorf("prev-period fields = %+v, want cost_prev 10.88 / runs_prev 53110", got.Items[0])
	}
}

func TestMetricsAgentDetail(t *testing.T) {
	p95 := 6.4
	repo := &mocks.MockMetricsRepository{
		AgentDetailV: model.AgentDetail{
			Name: "rewrite-message", Calls: 156, Cost: 0.3104,
			AvgLatencyMs: 4800, P95LatencyMs: &p95, ErrorRate: 0.083,
			InputTokens: 41000, OutputTokens: 9000,
			Model: "claude-haiku-4-5", Provider: "anthropic",
			Tools:       []model.AvailableTool{{Name: "tone.classify", Used: true, Description: "scores tone"}},
			LastTraceID: "t_eb7c",
		},
	}
	h := NewMetricsHandler(repo)

	rr := httptest.NewRecorder()
	h.AgentDetail(rr, agentDetailRequest("rewrite-message", "range=7d"))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var got model.AgentDetail
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Name != "rewrite-message" || got.Calls != 156 || got.Provider != "anthropic" {
		t.Errorf("detail = %+v, want rewrite-message / 156 / anthropic", got)
	}
	if got.P95LatencyMs == nil || *got.P95LatencyMs != 6.4 {
		t.Errorf("p95 = %v, want 6.4", got.P95LatencyMs)
	}
	if len(got.Tools) != 1 || !got.Tools[0].Used {
		t.Errorf("tools = %+v, want one used tool", got.Tools)
	}
}

func TestMetricsAgentDetailNotFound(t *testing.T) {
	repo := &mocks.MockMetricsRepository{Err: query.ErrNotFound}
	h := NewMetricsHandler(repo)

	rr := httptest.NewRecorder()
	h.AgentDetail(rr, agentDetailRequest("ghost-agent", "range=7d"))

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
	var body model.ErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Code != "AGENT_NOT_FOUND" {
		t.Errorf("code = %q, want AGENT_NOT_FOUND", body.Code)
	}
}

// Per-agent latency can't come from the daily rollup, so agent-scoped requests
// over rollup ranges (>30d) are rejected rather than silently degraded.
func TestMetricsAgentDetailRejectsRollupRange(t *testing.T) {
	h := NewMetricsHandler(&mocks.MockMetricsRepository{})

	rr := httptest.NewRecorder()
	h.AgentDetail(rr, agentDetailRequest("rewrite-message", "range=1y"))

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

// The agent query param on the series endpoints is likewise a raw-window feature.
func TestMetricsSeriesAgentRejectsRollupRange(t *testing.T) {
	h := NewMetricsHandler(&mocks.MockMetricsRepository{})

	rr := httptest.NewRecorder()
	h.CostSeries(rr, httptest.NewRequest(http.MethodGet, "/v1/metrics/cost-series?range=90d&agent=rewrite-message", nil))

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestMetricsBadRange(t *testing.T) {
	h := NewMetricsHandler(&mocks.MockMetricsRepository{})

	rr := httptest.NewRecorder()
	h.KPIs(rr, httptest.NewRequest(http.MethodGet, "/v1/metrics/kpis?range=nonsense", nil))

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
}

func TestMetricsFailuresEnvelope(t *testing.T) {
	repo := &mocks.MockMetricsRepository{
		FailureItems:  []model.Failure{{Agent: "rewrite-message", Count: 8, Pct: 0.083, TopError: "rate_limit_exceeded"}},
		FailuresTotal: 12,
	}
	h := NewMetricsHandler(repo)

	rr := httptest.NewRecorder()
	h.Failures(rr, httptest.NewRequest(http.MethodGet, "/v1/metrics/failures?range=24h", nil))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	// Total reflects every failed run, not just the listed agents.
	var got struct {
		Items []model.Failure `json:"items"`
		Total int             `json:"total"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Total != 12 {
		t.Errorf("total = %d, want 12", got.Total)
	}
	if len(got.Items) != 1 || got.Items[0].Agent != "rewrite-message" {
		t.Errorf("items = %+v, want one rewrite-message row", got.Items)
	}
}

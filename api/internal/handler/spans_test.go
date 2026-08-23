package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/tracium/api/internal/model"
	"github.com/tracium/api/testing/mocks"
)

// spansRequest builds a request carrying the {traceId} path param the way chi
// would, so ListSpans' chi.URLParam("traceId") resolves in a unit test.
func spansRequest(traceID string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/v1/traces/"+traceID+"/spans", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("traceId", traceID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
}

func listSpans(t *testing.T, spans []model.Span) *httptest.ResponseRecorder {
	t.Helper()
	repo := mocks.NewMockTraceRepository()
	repo.SpansMap["trace-1"] = spans

	rr := httptest.NewRecorder()
	NewSpanHandler(repo).ListSpans(rr, spansRequest("trace-1"))
	return rr
}

// Rule 5: a row written by a newer collector must not be served as fact.
func TestListSpansRefusesNewerSchema(t *testing.T) {
	rr := listSpans(t, []model.Span{
		{SpanID: "a", SchemaVersion: 1},
		{SpanID: "b", SchemaVersion: 99},
	})

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusInternalServerError)
	}
	var body model.ErrorResponse
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Code != "SCHEMA_INCOMPATIBLE" {
		t.Errorf("code = %q, want SCHEMA_INCOMPATIBLE", body.Code)
	}
}

// The other direction: an older row is served, never refused.
func TestListSpansServesOlderSchema(t *testing.T) {
	rr := listSpans(t, []model.Span{{SpanID: "a", SchemaVersion: 0}})

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	var page struct {
		Total int `json:"total"`
	}
	if err := json.NewDecoder(rr.Body).Decode(&page); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if page.Total != 1 {
		t.Errorf("total = %d, want 1", page.Total)
	}
}

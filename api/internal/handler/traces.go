package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/tracium/api/internal/model"
	"github.com/tracium/api/internal/query"
)

// TraceHandler handles all trace-related endpoints.
type TraceHandler struct {
	repo query.TraceRepository
}

// NewTraceHandler constructs a TraceHandler with the given repository.
func NewTraceHandler(repo query.TraceRepository) *TraceHandler {
	return &TraceHandler{repo: repo}
}

// ListTraces handles GET /v1/traces.
// Accepts query params: tenant_id, model, has_error, page, page_size.
func (h *TraceHandler) ListTraces(w http.ResponseWriter, r *http.Request) {
	filter := query.TraceFilter{}

	q := r.URL.Query()

	// tenant_id identifies the operator's own end-client — a business dimension
	// of the data, not an access boundary. It's an optional filter, like model.
	if tenantID := q.Get("tenant_id"); tenantID != "" {
		filter.TenantID = tenantID
	}

	// range bounds the listing to a time window (default 30d) so it never scans
	// the whole table; the explorer can widen/narrow it. Same tokens as metrics.
	rng := q.Get("range")
	if rng == "" {
		rng = "30d"
	}
	win, err := query.ParseRange(rng, time.Now())
	if err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}
	filter.StartAfter, filter.StartBefore = win.Start, win.End

	if model := q.Get("model"); model != "" {
		filter.Model = model
	}

	// agent restricts the listing to one derived agent — powers an agent's
	// "recent runs". Bounded like any listing by the range window above.
	if agent := q.Get("agent"); agent != "" {
		filter.Agent = agent
	}

	if hasErrorStr := q.Get("has_error"); hasErrorStr != "" {
		b, err := strconv.ParseBool(hasErrorStr)
		if err != nil {
			respondError(w, http.StatusBadRequest, "BAD_REQUEST", "has_error must be a boolean")
			return
		}
		filter.HasError = &b
	}

	if pageStr := q.Get("page"); pageStr != "" {
		p, err := strconv.Atoi(pageStr)
		if err != nil || p < 1 {
			respondError(w, http.StatusBadRequest, "BAD_REQUEST", "page must be a positive integer")
			return
		}
		filter.Page = p
	}

	if pageSizeStr := q.Get("page_size"); pageSizeStr != "" {
		ps, err := strconv.Atoi(pageSizeStr)
		if err != nil || ps < 1 {
			respondError(w, http.StatusBadRequest, "BAD_REQUEST", "page_size must be a positive integer")
			return
		}
		filter.PageSize = ps
	}

	if err := filter.Validate(); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
		return
	}

	traces, total, err := h.repo.ListTraces(r.Context(), filter)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "failed to list traces")
		return
	}

	respondPage(w, traces, int(total), filter.Page, filter.PageSize)
}

// GetTrace handles GET /v1/traces/{id}, returning the trace with its spans.
func (h *TraceHandler) GetTrace(w http.ResponseWriter, r *http.Request) {
	traceID := chi.URLParam(r, "id")
	if traceID == "" {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "trace id is required")
		return
	}

	trace, err := h.repo.GetTrace(r.Context(), traceID)
	if err != nil {
		if errors.Is(err, query.ErrNotFound) {
			respondError(w, http.StatusNotFound, "TRACE_NOT_FOUND", "trace not found")
			return
		}
		respondError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	spans, err := h.repo.GetSpans(r.Context(), traceID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
		return
	}

	respondJSON(w, http.StatusOK, model.TraceDetail{Trace: *trace, Spans: spans})
}

package handler

import "net/http"

// HealthHandler handles liveness and readiness probe endpoints.
// These routes are registered without auth middleware.
type HealthHandler struct{}

// NewHealthHandler constructs a HealthHandler.
func NewHealthHandler() *HealthHandler {
	return &HealthHandler{}
}

// Health handles GET /v1/health — liveness probe.
func (h *HealthHandler) Health(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Ready handles GET /v1/ready — readiness probe.
func (h *HealthHandler) Ready(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

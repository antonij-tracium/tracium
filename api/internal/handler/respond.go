package handler

import (
	"encoding/json"
	"net/http"

	"github.com/tracium/api/internal/model"
)

// respondJSON writes v as JSON with the given HTTP status code.
// Always use this instead of calling json.NewEncoder directly in handlers.
func respondJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// respondError writes a standard ErrorResponse JSON body with the given status.
func respondError(w http.ResponseWriter, status int, code, message string) {
	respondJSON(w, status, model.ErrorResponse{Code: code, Message: message})
}

// respondPage writes a 200 with the standard paginated list envelope.
func respondPage(w http.ResponseWriter, items any, total, page, pageSize int) {
	respondJSON(w, http.StatusOK, model.Page{
		Items:    items,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}

package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/tracium/api/internal/middleware"
	"github.com/tracium/api/internal/model"
	"github.com/tracium/api/internal/workspace"
)

// WorkspaceHandler handles workspace CRUD for the authenticated user.
type WorkspaceHandler struct {
	store workspace.Store
}

// NewWorkspaceHandler constructs a WorkspaceHandler.
func NewWorkspaceHandler(store workspace.Store) *WorkspaceHandler {
	return &WorkspaceHandler{store: store}
}

// List handles GET /v1/workspaces — returns all workspaces for the current user.
func (h *WorkspaceHandler) List(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok || principal.UserID == "" {
		respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "user identity could not be resolved")
		return
	}

	workspaces, err := h.store.List(r.Context(), principal.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "could not fetch workspaces")
		return
	}

	if workspaces == nil {
		workspaces = []model.Workspace{}
	}
	respondJSON(w, http.StatusOK, workspaces)
}

// Create handles POST /v1/workspaces — creates a new workspace for the current user.
func (h *WorkspaceHandler) Create(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok || principal.UserID == "" {
		respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "user identity could not be resolved")
		return
	}

	var body struct {
		Name string `json:"name"`
		Slug string `json:"slug"`
		Env  string `json:"env"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "request body must be valid JSON")
		return
	}
	if body.Name == "" || body.Slug == "" || body.Env == "" {
		respondError(w, http.StatusBadRequest, "MISSING_FIELDS", "name, slug, and env are required")
		return
	}

	ws := model.Workspace{
		ID:      uuid.NewString(),
		UserID:  principal.UserID,
		Name:    body.Name,
		Slug:    body.Slug,
		Env:     body.Env,
		Role:    "Owner",
		Members: 1,
		Plan:    "Free",
	}
	if err := h.store.Create(r.Context(), ws); err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "could not create workspace")
		return
	}

	respondJSON(w, http.StatusCreated, ws)
}

// Delete handles DELETE /v1/workspaces/{id} — removes a workspace owned by the current user.
func (h *WorkspaceHandler) Delete(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok || principal.UserID == "" {
		respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "user identity could not be resolved")
		return
	}

	id := chi.URLParam(r, "id")
	if err := h.store.Delete(r.Context(), id, principal.UserID); err != nil {
		// 404, not 403, when the workspace belongs to someone else — never
		// reveal that another user's workspace exists.
		if errors.Is(err, workspace.ErrNotFound) {
			respondError(w, http.StatusNotFound, "WORKSPACE_NOT_FOUND", "workspace not found")
			return
		}
		respondError(w, http.StatusInternalServerError, "INTERNAL", "could not delete workspace")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

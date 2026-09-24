package handler

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/tracium/api/internal/middleware"
)

// WorkspaceAccess resolves which workspaces an authenticated account may read.
// The data handlers depend on this interface (satisfied by the workspace store)
// to enforce the read-side access boundary.
type WorkspaceAccess interface {
	AllowedIDs(ctx context.Context, userID string) ([]string, error)
}

// resolveWorkspaceScope determines the set of workspace ids a request is allowed
// to read, and enforces access. `requested` is the optional workspace_id query
// param:
//
//   - present: the caller must be a member of it, or the request is refused with
//     403; the scope is that one workspace.
//   - absent: the scope is every workspace the caller is a member of (so a direct
//     API call without a workspace_id sees all of the caller's data, and the
//     dashboard — which always sends the active workspace — sees just that one).
//
// An account that is a member of no workspace yields an empty scope, which the
// query layer compiles to "match nothing" — never "match everything". On any
// failure it writes the HTTP error and returns ok=false.
func resolveWorkspaceScope(w http.ResponseWriter, r *http.Request, access WorkspaceAccess, requested string) ([]string, bool) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok || principal.UserID == "" {
		respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "user identity could not be resolved")
		return nil, false
	}

	allowed, err := access.AllowedIDs(r.Context(), principal.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "could not resolve workspace access")
		return nil, false
	}

	if requested != "" {
		for _, id := range allowed {
			if id == requested {
				return []string{requested}, true
			}
		}
		respondError(w, http.StatusForbidden, "FORBIDDEN", "you do not have access to that workspace")
		return nil, false
	}
	return allowed, true
}

// OwnerCheck reports whether a user owns a workspace. Satisfied by the workspace
// store.
type OwnerCheck interface {
	IsOwner(ctx context.Context, workspaceID, userID string) (bool, error)
}

// requireOwner resolves the caller and checks they own the {id} workspace, for
// routes that manage a workspace. It answers 404 to non-owners — never reveal
// that a workspace the caller can't manage exists. On any failure it writes the
// HTTP error and returns ok=false.
func requireOwner(w http.ResponseWriter, r *http.Request, owners OwnerCheck) (userID, workspaceID string, ok bool) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok || principal.UserID == "" {
		respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "user identity could not be resolved")
		return "", "", false
	}
	workspaceID = chi.URLParam(r, "id")
	owner, err := owners.IsOwner(r.Context(), workspaceID, principal.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "could not verify ownership")
		return "", "", false
	}
	if !owner {
		respondError(w, http.StatusNotFound, "WORKSPACE_NOT_FOUND", "workspace not found")
		return "", "", false
	}
	return principal.UserID, workspaceID, true
}

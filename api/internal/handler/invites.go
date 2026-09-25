package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/tracium/api/extension"
	"github.com/tracium/api/internal/auth"
	"github.com/tracium/api/internal/middleware"
	"github.com/tracium/api/internal/model"
	tokens "github.com/tracium/api/internal/token"
	"github.com/tracium/api/internal/workspace"
)

// InviteFeature is the entitlement checked before creating an invite.
const InviteFeature = "workspaces.invite"

// InviteHandler manages workspace invitations.
type InviteHandler struct {
	invites      workspace.InviteStore
	owners       OwnerCheck
	entitlements extension.Entitlements
}

// NewInviteHandler constructs an InviteHandler. A nil entitlements allows all invites.
func NewInviteHandler(invites workspace.InviteStore, owners OwnerCheck, entitlements extension.Entitlements) *InviteHandler {
	return &InviteHandler{invites: invites, owners: owners, entitlements: entitlements}
}

const maxInviteBody = 4 << 10 // 4 KiB

// Create handles POST /v1/workspaces/{id}/invites. Owner-only.
func (h *InviteHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, ok := requireOwner(w, r, h.owners)
	if !ok {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxInviteBody)
	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "BAD_REQUEST", "request body must be valid JSON")
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if email == "" {
		respondError(w, http.StatusBadRequest, "MISSING_FIELDS", "email is required")
		return
	}
	if err := auth.ValidateEmail(email); err != nil {
		respondError(w, http.StatusBadRequest, "INVALID_EMAIL", err.Error())
		return
	}

	if h.entitlements != nil {
		decision, err := h.entitlements.Check(r.Context(), extension.Subject{UserID: userID, WorkspaceID: workspaceID}, InviteFeature)
		if err != nil {
			respondError(w, http.StatusServiceUnavailable, "UNAVAILABLE", "could not check entitlements")
			return
		}
		if !decision.Allowed {
			respondError(w, http.StatusForbidden, "FEATURE_UNAVAILABLE", "inviting members is not available for this workspace")
			return
		}
	}

	token, err := tokens.New(workspace.InviteTokenPrefix)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "could not create invite")
		return
	}
	inv := model.WorkspaceInvite{
		ID:          uuid.NewString(),
		WorkspaceID: workspaceID,
		Email:       email,
		Role:        workspace.RoleMember,
		InvitedBy:   userID,
		ExpiresAt:   time.Now().Add(workspace.InviteTTL).UTC(),
	}
	if err := h.invites.CreateInvite(r.Context(), &inv, tokens.Hash(token)); err != nil {
		if errors.Is(err, workspace.ErrAlreadyMember) {
			respondError(w, http.StatusConflict, "ALREADY_MEMBER", "that account is already a member of this workspace")
			return
		}
		respondError(w, http.StatusInternalServerError, "INTERNAL", "could not create invite")
		return
	}
	respondJSON(w, http.StatusCreated, model.CreatedInvite{WorkspaceInvite: inv, Token: token})
}

// List handles GET /v1/workspaces/{id}/invites. Owner-only.
func (h *InviteHandler) List(w http.ResponseWriter, r *http.Request) {
	_, workspaceID, ok := requireOwner(w, r, h.owners)
	if !ok {
		return
	}
	invites, err := h.invites.ListInvites(r.Context(), workspaceID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "INTERNAL", "could not fetch invites")
		return
	}
	if invites == nil {
		invites = []model.WorkspaceInvite{}
	}
	respondJSON(w, http.StatusOK, invites)
}

// Revoke handles DELETE /v1/workspaces/{id}/invites/{inviteId}. Owner-only.
func (h *InviteHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	_, workspaceID, ok := requireOwner(w, r, h.owners)
	if !ok {
		return
	}
	if err := h.invites.RevokeInvite(r.Context(), workspaceID, chi.URLParam(r, "inviteId")); err != nil {
		if errors.Is(err, workspace.ErrInviteNotFound) {
			respondError(w, http.StatusNotFound, "INVITE_NOT_FOUND", "invite not found")
			return
		}
		respondError(w, http.StatusInternalServerError, "INTERNAL", "could not revoke invite")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Preview handles GET /v1/invites/{token}. It needs no session.
func (h *InviteHandler) Preview(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if !tokens.Valid(workspace.InviteTokenPrefix, token) {
		respondError(w, http.StatusNotFound, "INVITE_NOT_FOUND", "invite not found")
		return
	}
	preview, err := h.invites.PreviewInvite(r.Context(), tokens.Hash(token))
	if err != nil {
		respondInviteError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, preview)
}

// Accept handles POST /v1/invites/{token}/accept.
func (h *InviteHandler) Accept(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok || principal.UserID == "" {
		respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "user identity could not be resolved")
		return
	}
	token := chi.URLParam(r, "token")
	if !tokens.Valid(workspace.InviteTokenPrefix, token) {
		respondError(w, http.StatusNotFound, "INVITE_NOT_FOUND", "invite not found")
		return
	}

	workspaceID, err := h.invites.AcceptInvite(r.Context(), tokens.Hash(token), principal.UserID)
	if err != nil {
		respondInviteError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, struct {
		WorkspaceID string `json:"workspace_id"`
	}{workspaceID})
}

func respondInviteError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, workspace.ErrInviteNotFound):
		respondError(w, http.StatusNotFound, "INVITE_NOT_FOUND", "invite not found")
	case errors.Is(err, workspace.ErrInviteClosed):
		respondError(w, http.StatusGone, "INVITE_EXPIRED", "this invite has expired or is no longer valid")
	case errors.Is(err, workspace.ErrInviteEmailMismatch):
		respondError(w, http.StatusForbidden, "INVITE_EMAIL_MISMATCH", "this invite was sent to a different email address")
	default:
		respondError(w, http.StatusInternalServerError, "INTERNAL", "could not process invite")
	}
}

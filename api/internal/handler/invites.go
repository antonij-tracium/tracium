package handler

import (
	"context"
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
	"github.com/tracium/api/internal/workspace"
)

// InviteFeature is the entitlement consulted, per workspace, before an owner may
// create an invite. The default provider allows it; a hosted provider can use it
// to enforce seat limits.
const InviteFeature = "workspaces.invite"

// OwnerCheck reports whether a user owns a workspace. Satisfied by the workspace
// store.
type OwnerCheck interface {
	IsOwner(ctx context.Context, workspaceID, userID string) (bool, error)
}

// UserByID resolves an account by id, so an accepting user's email can be
// compared with the invited address. Satisfied by the auth user store.
type UserByID interface {
	ByID(ctx context.Context, id string) (*model.User, error)
}

// InviteHandler manages workspace invitations. Owners create, list and revoke
// invites for a workspace; the holder of an invite link previews it without a
// session and accepts it while signed in to the invited account.
type InviteHandler struct {
	invites      workspace.InviteStore
	owners       OwnerCheck
	users        UserByID
	entitlements extension.Entitlements
	now          func() time.Time
}

// NewInviteHandler constructs an InviteHandler. entitlements may be nil, in
// which case invite creation is not gated.
func NewInviteHandler(invites workspace.InviteStore, owners OwnerCheck, users UserByID, entitlements extension.Entitlements) *InviteHandler {
	return &InviteHandler{invites: invites, owners: owners, users: users, entitlements: entitlements, now: time.Now}
}

// maxInviteBody caps invite request bodies; they carry a single email address.
const maxInviteBody = 4 << 10 // 4 KiB

// requireOwner resolves the caller and checks they own the {id} workspace. It
// answers 404 to non-owners — never reveal a workspace the caller can't manage.
func (h *InviteHandler) requireOwner(w http.ResponseWriter, r *http.Request) (userID, workspaceID string, ok bool) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok || principal.UserID == "" {
		respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "user identity could not be resolved")
		return "", "", false
	}
	workspaceID = chi.URLParam(r, "id")
	owner, err := h.owners.IsOwner(r.Context(), workspaceID, principal.UserID)
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

// Create handles POST /v1/workspaces/{id}/invites — invites an email address to
// the workspace as a member. Owner-only. The link token is in the response
// exactly once; the owner shares the link with the invitee.
func (h *InviteHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, ok := h.requireOwner(w, r)
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

	token, hash, err := workspace.NewInviteToken()
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
		ExpiresAt:   h.now().Add(workspace.InviteTTL).UTC(),
	}
	if err := h.invites.CreateInvite(r.Context(), &inv, hash); err != nil {
		if errors.Is(err, workspace.ErrAlreadyMember) {
			respondError(w, http.StatusConflict, "ALREADY_MEMBER", "that account is already a member of this workspace")
			return
		}
		respondError(w, http.StatusInternalServerError, "INTERNAL", "could not create invite")
		return
	}
	respondJSON(w, http.StatusCreated, model.CreatedInvite{WorkspaceInvite: inv, Token: token})
}

// List handles GET /v1/workspaces/{id}/invites — the workspace's open invites.
// Owner-only.
func (h *InviteHandler) List(w http.ResponseWriter, r *http.Request) {
	_, workspaceID, ok := h.requireOwner(w, r)
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

// Revoke handles DELETE /v1/workspaces/{id}/invites/{inviteId} — closes an open
// invite so its link stops working. Owner-only.
func (h *InviteHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	_, workspaceID, ok := h.requireOwner(w, r)
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

// Preview handles GET /v1/invites/{token} — describes an invite to the holder of
// its link, who may not be signed in yet. Session-less, so it is mounted behind
// the auth-endpoint rate limiter.
func (h *InviteHandler) Preview(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if !workspace.LooksLikeInviteToken(token) {
		respondError(w, http.StatusNotFound, "INVITE_NOT_FOUND", "invite not found")
		return
	}
	preview, err := h.invites.PreviewInvite(r.Context(), workspace.HashInviteToken(token))
	if err != nil {
		respondInviteError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, preview)
}

// Accept handles POST /v1/invites/{token}/accept — joins the signed-in account to
// the invite's workspace. The account's email must be the invited address.
func (h *InviteHandler) Accept(w http.ResponseWriter, r *http.Request) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok || principal.UserID == "" {
		respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "user identity could not be resolved")
		return
	}
	token := chi.URLParam(r, "token")
	if !workspace.LooksLikeInviteToken(token) {
		respondError(w, http.StatusNotFound, "INVITE_NOT_FOUND", "invite not found")
		return
	}

	user, err := h.users.ByID(r.Context(), principal.UserID)
	if err != nil {
		if errors.Is(err, auth.ErrUserNotFound) {
			respondError(w, http.StatusUnauthorized, "UNAUTHORIZED", "user identity could not be resolved")
			return
		}
		respondError(w, http.StatusInternalServerError, "INTERNAL", "could not look up account")
		return
	}

	workspaceID, err := h.invites.AcceptInvite(r.Context(), workspace.HashInviteToken(token), user.ID, user.Email)
	if err != nil {
		respondInviteError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, struct {
		WorkspaceID string `json:"workspace_id"`
	}{workspaceID})
}

// respondInviteError maps the invite store's sentinel errors to responses.
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

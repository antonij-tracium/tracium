package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/tracium/api/extension"
	"github.com/tracium/api/internal/auth"
	"github.com/tracium/api/internal/middleware"
	"github.com/tracium/api/internal/model"
	"github.com/tracium/api/internal/workspace"
	"github.com/tracium/api/testing/mocks"
)

// stubUsers resolves accounts by id from a fixed map.
type stubUsers map[string]string // id -> email

func (s stubUsers) ByID(_ context.Context, id string) (*model.User, error) {
	email, ok := s[id]
	if !ok {
		return nil, auth.ErrUserNotFound
	}
	return &model.User{ID: id, Email: email}, nil
}

// stubEntitlements answers every check with a fixed decision or error.
type stubEntitlements struct {
	allowed bool
	err     error
}

func (s stubEntitlements) Check(context.Context, extension.Subject, string) (extension.Decision, error) {
	return extension.Decision{Allowed: s.allowed}, s.err
}

type inviteFixture struct {
	h       *InviteHandler
	invites *mocks.MockInviteStore
}

// newInviteFixture builds a handler where user-a owns ws-1, and user-b
// (b@example.com) and user-c (c@example.com) exist.
func newInviteFixture(ent extension.Entitlements) inviteFixture {
	owners := &mocks.MockWorkspaceStore{Workspaces: []model.Workspace{mocks.NewTestWorkspace("ws-1", "user-a")}}
	invites := &mocks.MockInviteStore{}
	users := stubUsers{"user-a": "a@example.com", "user-b": "b@example.com", "user-c": "c@example.com"}
	return inviteFixture{h: NewInviteHandler(invites, owners, users, ent), invites: invites}
}

// serve runs handler as userID (or unauthenticated when userID is empty) with
// the given chi URL params.
func serve(handler http.HandlerFunc, method, body, userID string, params map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "/", strings.NewReader(body))
	rctx := chi.NewRouteContext()
	for k, v := range params {
		rctx.URLParams.Add(k, v)
	}
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rr := httptest.NewRecorder()
	if userID == "" {
		handler.ServeHTTP(rr, req)
		return rr
	}
	req.Header.Set("Authorization", "Bearer test-token")
	middleware.Auth(stubAuthenticator{userID: userID})(handler).ServeHTTP(rr, req)
	return rr
}

func errorCode(t *testing.T, rr *httptest.ResponseRecorder) string {
	t.Helper()
	var body model.ErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body: %v (%s)", err, rr.Body.String())
	}
	return body.Code
}

// createInvite has user-a invite email to ws-1 and returns the plaintext token.
func (f inviteFixture) createInvite(t *testing.T, email string) string {
	t.Helper()
	rr := serve(f.h.Create, http.MethodPost, `{"email":"`+email+`"}`, "user-a", map[string]string{"id": "ws-1"})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: status = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	var created model.CreatedInvite
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return created.Token
}

func TestInviteCreate(t *testing.T) {
	f := newInviteFixture(nil)
	rr := serve(f.h.Create, http.MethodPost, `{"email":"  New@Example.com "}`, "user-a", map[string]string{"id": "ws-1"})

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	var created model.CreatedInvite
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !workspace.LooksLikeInviteToken(created.Token) {
		t.Errorf("token = %q, not an invite token", created.Token)
	}
	if created.Email != "new@example.com" {
		t.Errorf("email = %q, want normalized new@example.com", created.Email)
	}
	if created.Role != workspace.RoleMember || created.InvitedBy != "user-a" || created.WorkspaceID != "ws-1" {
		t.Errorf("unexpected invite: %+v", created.WorkspaceInvite)
	}
	if _, ok := f.invites.Invites[workspace.HashInviteToken(created.Token)]; !ok {
		t.Error("store did not receive the token's hash")
	}
	if d := time.Until(created.ExpiresAt); d < workspace.InviteTTL-time.Minute || d > workspace.InviteTTL {
		t.Errorf("expires in %v, want ~%v", d, workspace.InviteTTL)
	}
}

func TestInviteCreateRejections(t *testing.T) {
	tests := []struct {
		name   string
		ent    extension.Entitlements
		user   string
		body   string
		status int
		code   string
	}{
		{"non-owner", nil, "user-b", `{"email":"x@example.com"}`, http.StatusNotFound, "WORKSPACE_NOT_FOUND"},
		{"missing email", nil, "user-a", `{}`, http.StatusBadRequest, "MISSING_FIELDS"},
		{"invalid email", nil, "user-a", `{"email":"Bob <b@example.com>"}`, http.StatusBadRequest, "INVALID_EMAIL"},
		{"bad json", nil, "user-a", `{`, http.StatusBadRequest, "BAD_REQUEST"},
		{"entitlement denied", stubEntitlements{allowed: false}, "user-a", `{"email":"x@example.com"}`, http.StatusForbidden, "FEATURE_UNAVAILABLE"},
		{"entitlement error", stubEntitlements{err: errors.New("down")}, "user-a", `{"email":"x@example.com"}`, http.StatusServiceUnavailable, "UNAVAILABLE"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newInviteFixture(tt.ent)
			rr := serve(f.h.Create, http.MethodPost, tt.body, tt.user, map[string]string{"id": "ws-1"})
			if rr.Code != tt.status {
				t.Fatalf("status = %d, want %d (%s)", rr.Code, tt.status, rr.Body.String())
			}
			if code := errorCode(t, rr); code != tt.code {
				t.Errorf("code = %q, want %q", code, tt.code)
			}
			if len(f.invites.Invites) != 0 {
				t.Error("an invite was stored")
			}
		})
	}
}

func TestInviteCreateAlreadyMember(t *testing.T) {
	f := newInviteFixture(nil)
	f.invites.MemberEmails = map[string]bool{"ws-1/b@example.com": true}

	rr := serve(f.h.Create, http.MethodPost, `{"email":"b@example.com"}`, "user-a", map[string]string{"id": "ws-1"})
	if rr.Code != http.StatusConflict || errorCode(t, rr) != "ALREADY_MEMBER" {
		t.Fatalf("status = %d (%s), want 409 ALREADY_MEMBER", rr.Code, rr.Body.String())
	}
}

func TestInviteReinviteReplacesLink(t *testing.T) {
	f := newInviteFixture(nil)
	first := f.createInvite(t, "b@example.com")
	second := f.createInvite(t, "b@example.com")

	rr := serve(f.h.Preview, http.MethodGet, "", "", map[string]string{"token": first})
	if rr.Code != http.StatusGone {
		t.Errorf("old link: status = %d, want 410", rr.Code)
	}
	rr = serve(f.h.Preview, http.MethodGet, "", "", map[string]string{"token": second})
	if rr.Code != http.StatusOK {
		t.Errorf("new link: status = %d, want 200", rr.Code)
	}
}

func TestInviteListAndRevoke(t *testing.T) {
	f := newInviteFixture(nil)
	token := f.createInvite(t, "b@example.com")
	inviteID := f.invites.Invites[workspace.HashInviteToken(token)].Invite.ID

	if rr := serve(f.h.List, http.MethodGet, "", "user-b", map[string]string{"id": "ws-1"}); rr.Code != http.StatusNotFound {
		t.Errorf("non-owner list: status = %d, want 404", rr.Code)
	}
	if rr := serve(f.h.Revoke, http.MethodDelete, "", "user-b", map[string]string{"id": "ws-1", "inviteId": inviteID}); rr.Code != http.StatusNotFound {
		t.Errorf("non-owner revoke: status = %d, want 404", rr.Code)
	}

	rr := serve(f.h.List, http.MethodGet, "", "user-a", map[string]string{"id": "ws-1"})
	var listed []model.WorkspaceInvite
	if err := json.Unmarshal(rr.Body.Bytes(), &listed); err != nil || len(listed) != 1 || listed[0].ID != inviteID {
		t.Fatalf("list = %s, want the one invite", rr.Body.String())
	}

	if rr := serve(f.h.Revoke, http.MethodDelete, "", "user-a", map[string]string{"id": "ws-1", "inviteId": inviteID}); rr.Code != http.StatusNoContent {
		t.Fatalf("revoke: status = %d, want 204", rr.Code)
	}
	if rr := serve(f.h.Revoke, http.MethodDelete, "", "user-a", map[string]string{"id": "ws-1", "inviteId": inviteID}); rr.Code != http.StatusNotFound {
		t.Errorf("second revoke: status = %d, want 404", rr.Code)
	}
	rr = serve(f.h.List, http.MethodGet, "", "user-a", map[string]string{"id": "ws-1"})
	if strings.TrimSpace(rr.Body.String()) != "[]" {
		t.Errorf("list after revoke = %s, want []", rr.Body.String())
	}
	if rr := serve(f.h.Accept, http.MethodPost, "", "user-b", map[string]string{"token": token}); rr.Code != http.StatusGone {
		t.Errorf("accept revoked: status = %d, want 410", rr.Code)
	}
}

func TestInvitePreview(t *testing.T) {
	f := newInviteFixture(nil)
	token := f.createInvite(t, "b@example.com")

	rr := serve(f.h.Preview, http.MethodGet, "", "", map[string]string{"token": token})
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var p model.InvitePreview
	if err := json.Unmarshal(rr.Body.Bytes(), &p); err != nil || p.Email != "b@example.com" {
		t.Errorf("preview = %s", rr.Body.String())
	}

	for _, bad := range []string{"garbage", "trci_" + strings.Repeat("0", 64)} {
		rr := serve(f.h.Preview, http.MethodGet, "", "", map[string]string{"token": bad})
		if rr.Code != http.StatusNotFound || errorCode(t, rr) != "INVITE_NOT_FOUND" {
			t.Errorf("token %q: status = %d, want 404 INVITE_NOT_FOUND", bad, rr.Code)
		}
	}
}

func TestInviteAccept(t *testing.T) {
	f := newInviteFixture(nil)
	token := f.createInvite(t, "b@example.com")

	rr := serve(f.h.Accept, http.MethodPost, "", "user-c", map[string]string{"token": token})
	if rr.Code != http.StatusForbidden || errorCode(t, rr) != "INVITE_EMAIL_MISMATCH" {
		t.Fatalf("wrong account: status = %d (%s), want 403 INVITE_EMAIL_MISMATCH", rr.Code, rr.Body.String())
	}

	rr = serve(f.h.Accept, http.MethodPost, "", "user-b", map[string]string{"token": token})
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d (%s), want 200", rr.Code, rr.Body.String())
	}
	var body struct {
		WorkspaceID string `json:"workspace_id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil || body.WorkspaceID != "ws-1" {
		t.Errorf("body = %s, want workspace_id ws-1", rr.Body.String())
	}
	if len(f.invites.Joined) != 1 || f.invites.Joined[0] != "ws-1/user-b" {
		t.Errorf("joined = %v, want [ws-1/user-b]", f.invites.Joined)
	}

	rr = serve(f.h.Accept, http.MethodPost, "", "user-b", map[string]string{"token": token})
	if rr.Code != http.StatusGone || errorCode(t, rr) != "INVITE_EXPIRED" {
		t.Errorf("reuse: status = %d, want 410 INVITE_EXPIRED", rr.Code)
	}
}

func TestInviteAcceptExpired(t *testing.T) {
	f := newInviteFixture(nil)
	f.h.now = func() time.Time { return time.Now().Add(-workspace.InviteTTL - time.Hour) }
	token := f.createInvite(t, "b@example.com")

	if rr := serve(f.h.Accept, http.MethodPost, "", "user-b", map[string]string{"token": token}); rr.Code != http.StatusGone {
		t.Errorf("status = %d, want 410", rr.Code)
	}
	if len(f.invites.Joined) != 0 {
		t.Error("expired invite admitted a member")
	}
}

func TestInviteAcceptRequiresSession(t *testing.T) {
	f := newInviteFixture(nil)

	// No Authorization header: the auth middleware must refuse before the handler.
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rr := httptest.NewRecorder()
	middleware.Auth(stubAuthenticator{userID: "user-b"})(http.HandlerFunc(f.h.Accept)).ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rr.Code)
	}
}

func TestWorkspaceListMembers(t *testing.T) {
	store := &mocks.MockWorkspaceStore{
		Workspaces: []model.Workspace{mocks.NewTestWorkspace("ws-1", "user-a")},
		Members: map[string][]model.WorkspaceMember{
			"ws-1": {{UserID: "user-a", Email: "a@example.com", Role: workspace.RoleOwner}},
		},
	}
	h := NewWorkspaceHandler(store, stubUserLookup{})

	rr := serve(h.ListMembers, http.MethodGet, "", "user-a", map[string]string{"id": "ws-1"})
	var members []model.WorkspaceMember
	if rr.Code != http.StatusOK || json.Unmarshal(rr.Body.Bytes(), &members) != nil || len(members) != 1 || members[0].Email != "a@example.com" {
		t.Fatalf("member: status = %d, body = %s", rr.Code, rr.Body.String())
	}

	rr = serve(h.ListMembers, http.MethodGet, "", "user-b", map[string]string{"id": "ws-1"})
	if rr.Code != http.StatusForbidden {
		t.Errorf("non-member: status = %d, want 403", rr.Code)
	}
}

package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/tracium/api/extension"
	"github.com/tracium/api/internal/model"
	tokens "github.com/tracium/api/internal/token"
	"github.com/tracium/api/internal/workspace"
	"github.com/tracium/api/testing/mocks"
)

type stubEntitlements struct {
	allowed bool
	limit   *int64
	err     error
}

func (s stubEntitlements) Check(context.Context, extension.Subject, string) (extension.Decision, error) {
	return extension.Decision{Allowed: s.allowed, Limit: s.limit}, s.err
}

func limit(n int64) *int64 { return &n }

// stubNotifier records the invite it was handed and returns err.
type stubNotifier struct {
	err  error
	sent *extension.Invite
}

func (s *stubNotifier) InviteCreated(_ context.Context, inv extension.Invite) error {
	s.sent = &inv
	return s.err
}

// stubInvites records what the handler passes in and returns err from every call.
type stubInvites struct {
	err     error
	open    bool
	created *model.WorkspaceInvite
	hash    string
	userID  string
}

func (s *stubInvites) CreateInvite(_ context.Context, inv *model.WorkspaceInvite, hash string) error {
	s.created, s.hash = inv, hash
	return s.err
}

func (s *stubInvites) ListInvites(context.Context, string) ([]model.WorkspaceInvite, error) {
	return nil, s.err
}

func (s *stubInvites) HasOpenInvite(context.Context, string, string) (bool, error) {
	return s.open, nil
}

func (s *stubInvites) RevokeInvite(context.Context, string, string) error { return s.err }

func (s *stubInvites) PreviewInvite(_ context.Context, hash string) (*model.InvitePreview, error) {
	s.hash = hash
	return &model.InvitePreview{WorkspaceName: "Prod", InvitedByEmail: "a@example.com", Email: "b@example.com"}, s.err
}

func (s *stubInvites) AcceptInvite(ctx context.Context, hash, userID string, allow func(context.Context, string) error) (string, error) {
	s.hash, s.userID = hash, userID
	if s.err != nil {
		return "", s.err
	}
	if allow != nil {
		if err := allow(ctx, "ws-1"); err != nil {
			return "", err
		}
	}
	return "ws-1", nil
}

// newInviteHandler: user-a owns ws-1.
func newInviteHandler(invites *stubInvites, ent extension.Entitlements) *InviteHandler {
	owners := &mocks.MockWorkspaceStore{Workspaces: []model.Workspace{mocks.NewTestWorkspace("ws-1", "user-a")}}
	return NewInviteHandler(invites, owners, ent, nil)
}

var validToken = workspace.InviteTokenPrefix + strings.Repeat("a", 64)

func TestInviteCreate(t *testing.T) {
	invites := &stubInvites{}
	rr := serve(newInviteHandler(invites, nil).Create, http.MethodPost, `{"email":"  New@Example.com "}`, "user-a", map[string]string{"id": "ws-1"})

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	var created model.CreatedInvite
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !tokens.Valid(workspace.InviteTokenPrefix, created.Token) || invites.hash != tokens.Hash(created.Token) {
		t.Errorf("token %q not stored by its hash (got %q)", created.Token, invites.hash)
	}
	if created.Email != "new@example.com" || created.Role != workspace.RoleMember || created.InvitedBy != "user-a" || created.WorkspaceID != "ws-1" {
		t.Errorf("unexpected invite: %+v", created.WorkspaceInvite)
	}
	if d := time.Until(created.ExpiresAt); d < workspace.InviteTTL-time.Minute || d > workspace.InviteTTL {
		t.Errorf("expires in %v, want ~%v", d, workspace.InviteTTL)
	}
}

func TestInviteCreateRejections(t *testing.T) {
	tests := []struct {
		name     string
		ent      extension.Entitlements
		storeErr error
		user     string
		body     string
		status   int
		code     string
	}{
		{"non-owner", nil, nil, "user-b", `{"email":"x@example.com"}`, http.StatusNotFound, "WORKSPACE_NOT_FOUND"},
		{"missing email", nil, nil, "user-a", `{}`, http.StatusBadRequest, "MISSING_FIELDS"},
		{"invalid email", nil, nil, "user-a", `{"email":"Bob <b@example.com>"}`, http.StatusBadRequest, "INVALID_EMAIL"},
		{"bad json", nil, nil, "user-a", `{`, http.StatusBadRequest, "BAD_REQUEST"},
		{"entitlement denied", stubEntitlements{allowed: false}, nil, "user-a", `{"email":"x@example.com"}`, http.StatusForbidden, "FEATURE_UNAVAILABLE"},
		{"member limit reached", stubEntitlements{limit: limit(3)}, nil, "user-a", `{"email":"x@example.com"}`, http.StatusForbidden, "MEMBER_LIMIT_REACHED"},
		{"entitlement error", stubEntitlements{err: errors.New("down")}, nil, "user-a", `{"email":"x@example.com"}`, http.StatusServiceUnavailable, "UNAVAILABLE"},
		{"already member", nil, workspace.ErrAlreadyMember, "user-a", `{"email":"x@example.com"}`, http.StatusConflict, "ALREADY_MEMBER"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			invites := &stubInvites{err: tt.storeErr}
			rr := serve(newInviteHandler(invites, tt.ent).Create, http.MethodPost, tt.body, tt.user, map[string]string{"id": "ws-1"})
			if rr.Code != tt.status || errorCode(t, rr) != tt.code {
				t.Fatalf("got %d %s, want %d %s", rr.Code, rr.Body.String(), tt.status, tt.code)
			}
			if tt.storeErr == nil && invites.created != nil {
				t.Error("store was called")
			}
		})
	}
}

func TestInviteReplacementSkipsSeatCheck(t *testing.T) {
	invites := &stubInvites{open: true}
	rr := serve(newInviteHandler(invites, stubEntitlements{limit: limit(3)}).Create, http.MethodPost, `{"email":"b@example.com"}`, "user-a", map[string]string{"id": "ws-1"})
	if rr.Code != http.StatusCreated || invites.created == nil {
		t.Fatalf("new link for an open invite: status = %d, body = %s", rr.Code, rr.Body.String())
	}
}

func TestInviteCreateNotifies(t *testing.T) {
	owners := &mocks.MockWorkspaceStore{Workspaces: []model.Workspace{mocks.NewTestWorkspace("ws-1", "user-a")}}
	for _, tt := range []struct {
		name string
		err  error
		sent bool
	}{
		{"delivered", nil, true},
		{"notifier failure keeps the invite", errors.New("smtp down"), false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			notifier := &stubNotifier{err: tt.err}
			h := NewInviteHandler(&stubInvites{}, owners, nil, notifier)
			rr := serve(h.Create, http.MethodPost, `{"email":"b@example.com"}`, "user-a", map[string]string{"id": "ws-1"})
			var created model.CreatedInvite
			if rr.Code != http.StatusCreated || json.Unmarshal(rr.Body.Bytes(), &created) != nil {
				t.Fatalf("status = %d, body = %s", rr.Code, rr.Body.String())
			}
			if created.EmailSent != tt.sent {
				t.Errorf("email_sent = %v, want %v", created.EmailSent, tt.sent)
			}
			got := notifier.sent
			if got == nil || got.Token != created.Token || got.Email != "b@example.com" || got.WorkspaceName != "Prod" || got.InvitedByEmail != "a@example.com" || got.ID != created.ID {
				t.Errorf("notifier got %+v", got)
			}
		})
	}

	rr := serve(newInviteHandler(&stubInvites{}, nil).Create, http.MethodPost, `{"email":"b@example.com"}`, "user-a", map[string]string{"id": "ws-1"})
	if !strings.Contains(rr.Body.String(), `"email_sent":false`) {
		t.Errorf("without a notifier: body = %s", rr.Body.String())
	}
}

func TestInviteAcceptChecksSeats(t *testing.T) {
	link := map[string]string{"token": validToken}
	tests := []struct {
		name   string
		ent    stubEntitlements
		status int
		code   string
	}{
		{"full", stubEntitlements{limit: limit(3)}, http.StatusForbidden, "MEMBER_LIMIT_REACHED"},
		{"not entitled", stubEntitlements{}, http.StatusForbidden, "FEATURE_UNAVAILABLE"},
		{"provider down", stubEntitlements{err: errors.New("down")}, http.StatusServiceUnavailable, "UNAVAILABLE"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rr := serve(newInviteHandler(&stubInvites{}, tt.ent).Accept, http.MethodPost, "", "user-b", link)
			if rr.Code != tt.status || errorCode(t, rr) != tt.code {
				t.Fatalf("got %d %s, want %d %s", rr.Code, rr.Body.String(), tt.status, tt.code)
			}
		})
	}
	if rr := serve(newInviteHandler(&stubInvites{}, stubEntitlements{allowed: true}).Accept, http.MethodPost, "", "user-b", link); rr.Code != http.StatusOK {
		t.Errorf("allowed: status = %d, want 200", rr.Code)
	}
}

func TestAddMemberChecksSeats(t *testing.T) {
	store := &mocks.MockWorkspaceStore{Workspaces: []model.Workspace{mocks.NewTestWorkspace("ws-1", "user-a")}}
	h := NewWorkspaceHandler(store, stubUserLookup{}, stubEntitlements{limit: limit(3)})
	rr := serve(h.AddMember, http.MethodPost, `{"email":"b@example.com"}`, "user-a", map[string]string{"id": "ws-1"})
	if rr.Code != http.StatusForbidden || errorCode(t, rr) != "MEMBER_LIMIT_REACHED" || !strings.Contains(rr.Body.String(), "limit of 3 members") {
		t.Fatalf("got %d %s", rr.Code, rr.Body.String())
	}
}

func TestInviteListAndRevoke(t *testing.T) {
	h := newInviteHandler(&stubInvites{}, nil)
	ws := map[string]string{"id": "ws-1", "inviteId": "inv-1"}

	if rr := serve(h.List, http.MethodGet, "", "user-b", ws); rr.Code != http.StatusNotFound {
		t.Errorf("non-owner list: status = %d, want 404", rr.Code)
	}
	if rr := serve(h.Revoke, http.MethodDelete, "", "user-b", ws); rr.Code != http.StatusNotFound {
		t.Errorf("non-owner revoke: status = %d, want 404", rr.Code)
	}
	if rr := serve(h.List, http.MethodGet, "", "user-a", ws); strings.TrimSpace(rr.Body.String()) != "[]" {
		t.Errorf("list = %s, want []", rr.Body.String())
	}
	if rr := serve(h.Revoke, http.MethodDelete, "", "user-a", ws); rr.Code != http.StatusNoContent {
		t.Errorf("revoke: status = %d, want 204", rr.Code)
	}

	h = newInviteHandler(&stubInvites{err: workspace.ErrInviteNotFound}, nil)
	if rr := serve(h.Revoke, http.MethodDelete, "", "user-a", ws); rr.Code != http.StatusNotFound || errorCode(t, rr) != "INVITE_NOT_FOUND" {
		t.Errorf("revoke missing: status = %d, want 404 INVITE_NOT_FOUND", rr.Code)
	}
}

func TestInvitePreviewAndAccept(t *testing.T) {
	invites := &stubInvites{}
	h := newInviteHandler(invites, nil)
	link := map[string]string{"token": validToken}

	if rr := serve(h.Preview, http.MethodGet, "", "", link); rr.Code != http.StatusOK || invites.hash != tokens.Hash(validToken) {
		t.Errorf("preview: status = %d, hash = %q", rr.Code, invites.hash)
	}
	rr := serve(h.Accept, http.MethodPost, "", "user-b", link)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"workspace_id":"ws-1"`) || invites.userID != "user-b" {
		t.Errorf("accept: status = %d, body = %s, user = %q", rr.Code, rr.Body.String(), invites.userID)
	}
	if rr := serve(h.Accept, http.MethodPost, "", "", link); rr.Code != http.StatusUnauthorized {
		t.Errorf("accept without session: status = %d, want 401", rr.Code)
	}
	for _, handler := range []http.HandlerFunc{h.Preview, h.Accept} {
		if rr := serve(handler, http.MethodPost, "", "user-b", map[string]string{"token": "garbage"}); rr.Code != http.StatusNotFound {
			t.Errorf("malformed token: status = %d, want 404", rr.Code)
		}
	}
}

func TestInviteStoreErrors(t *testing.T) {
	tests := []struct {
		err    error
		status int
		code   string
	}{
		{workspace.ErrInviteNotFound, http.StatusNotFound, "INVITE_NOT_FOUND"},
		{workspace.ErrInviteClosed, http.StatusGone, "INVITE_EXPIRED"},
		{workspace.ErrInviteEmailMismatch, http.StatusForbidden, "INVITE_EMAIL_MISMATCH"},
		{errors.New("db down"), http.StatusInternalServerError, "INTERNAL"},
	}
	for _, tt := range tests {
		rr := serve(newInviteHandler(&stubInvites{err: tt.err}, nil).Accept, http.MethodPost, "", "user-b", map[string]string{"token": validToken})
		if rr.Code != tt.status || errorCode(t, rr) != tt.code {
			t.Errorf("%v: got %d %s, want %d %s", tt.err, rr.Code, rr.Body.String(), tt.status, tt.code)
		}
	}
}

func TestWorkspaceListMembers(t *testing.T) {
	store := &mocks.MockWorkspaceStore{
		Workspaces: []model.Workspace{mocks.NewTestWorkspace("ws-1", "user-a")},
		Members: map[string][]model.WorkspaceMember{
			"ws-1": {{UserID: "user-a", Email: "a@example.com", Role: workspace.RoleOwner}},
		},
	}
	h := NewWorkspaceHandler(store, stubUserLookup{}, nil)

	rr := serve(h.ListMembers, http.MethodGet, "", "user-a", map[string]string{"id": "ws-1"})
	var members []model.WorkspaceMember
	if rr.Code != http.StatusOK || json.Unmarshal(rr.Body.Bytes(), &members) != nil || len(members) != 1 || members[0].Email != "a@example.com" {
		t.Fatalf("member: status = %d, body = %s", rr.Code, rr.Body.String())
	}
	if rr := serve(h.ListMembers, http.MethodGet, "", "user-b", map[string]string{"id": "ws-1"}); rr.Code != http.StatusForbidden {
		t.Errorf("non-member: status = %d, want 403", rr.Code)
	}
}

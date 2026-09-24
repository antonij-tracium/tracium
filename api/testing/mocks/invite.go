package mocks

import (
	"context"
	"strings"
	"time"

	"github.com/tracium/api/internal/model"
	"github.com/tracium/api/internal/workspace"
)

// MockInvite is one invite held by MockInviteStore.
type MockInvite struct {
	Invite        model.WorkspaceInvite
	WorkspaceName string
	Closed        bool
}

// MockInviteStore is an in-memory workspace.InviteStore for handler tests.
type MockInviteStore struct {
	Invites      map[string]*MockInvite // keyed by token hash
	MemberEmails map[string]bool        // "workspaceID/email" pairs already in the workspace
	UserEmails   map[string]string      // user id -> account email
	Joined       []string               // "workspaceID/userID" added by AcceptInvite
	CreateErr    error
}

func (m *MockInviteStore) init() {
	if m.Invites == nil {
		m.Invites = map[string]*MockInvite{}
	}
}

func (m *MockInviteStore) CreateInvite(_ context.Context, inv *model.WorkspaceInvite, tokenHash string) error {
	m.init()
	if m.CreateErr != nil {
		return m.CreateErr
	}
	if m.MemberEmails[inv.WorkspaceID+"/"+inv.Email] {
		return workspace.ErrAlreadyMember
	}
	for _, existing := range m.Invites {
		if existing.Invite.WorkspaceID == inv.WorkspaceID && existing.Invite.Email == inv.Email {
			existing.Closed = true
		}
	}
	inv.CreatedAt = time.Now().UTC()
	m.Invites[tokenHash] = &MockInvite{Invite: *inv}
	return nil
}

func (m *MockInviteStore) ListInvites(_ context.Context, workspaceID string) ([]model.WorkspaceInvite, error) {
	m.init()
	var out []model.WorkspaceInvite
	for _, inv := range m.Invites {
		if inv.Invite.WorkspaceID == workspaceID && !inv.Closed {
			out = append(out, inv.Invite)
		}
	}
	return out, nil
}

func (m *MockInviteStore) RevokeInvite(_ context.Context, workspaceID, inviteID string) error {
	m.init()
	for _, inv := range m.Invites {
		if inv.Invite.ID == inviteID && inv.Invite.WorkspaceID == workspaceID && !inv.Closed {
			inv.Closed = true
			return nil
		}
	}
	return workspace.ErrInviteNotFound
}

func (m *MockInviteStore) PreviewInvite(_ context.Context, tokenHash string) (*model.InvitePreview, error) {
	m.init()
	inv, ok := m.Invites[tokenHash]
	if !ok {
		return nil, workspace.ErrInviteNotFound
	}
	if inv.Closed || !inv.Invite.ExpiresAt.After(time.Now()) {
		return nil, workspace.ErrInviteClosed
	}
	return &model.InvitePreview{WorkspaceName: inv.WorkspaceName, Email: inv.Invite.Email, ExpiresAt: inv.Invite.ExpiresAt}, nil
}

func (m *MockInviteStore) AcceptInvite(_ context.Context, tokenHash, userID string) (string, error) {
	m.init()
	inv, ok := m.Invites[tokenHash]
	if !ok {
		return "", workspace.ErrInviteNotFound
	}
	if inv.Closed || !inv.Invite.ExpiresAt.After(time.Now()) {
		return "", workspace.ErrInviteClosed
	}
	if email, ok := m.UserEmails[userID]; !ok || !strings.EqualFold(inv.Invite.Email, email) {
		return "", workspace.ErrInviteEmailMismatch
	}
	inv.Closed = true
	m.Joined = append(m.Joined, inv.Invite.WorkspaceID+"/"+userID)
	return inv.Invite.WorkspaceID, nil
}

package mocks

import (
	"context"

	"github.com/tracium/api/internal/model"
	"github.com/tracium/api/internal/workspace"
)

// MockWorkspaceStore is an in-memory implementation of workspace.Store for use
// in handler unit tests. It never touches a real database.
type MockWorkspaceStore struct {
	Workspaces []model.Workspace

	// Configurable errors — set these to simulate failures.
	ListErr   error
	CreateErr error
	DeleteErr error

	// Call counters — inspect these in tests.
	ListCallCount   int
	CreateCallCount int
	DeleteCallCount int
}

// List returns the stored workspaces belonging to the given user.
func (m *MockWorkspaceStore) List(_ context.Context, userID string) ([]model.Workspace, error) {
	m.ListCallCount++
	if m.ListErr != nil {
		return nil, m.ListErr
	}

	var result []model.Workspace
	for _, ws := range m.Workspaces {
		if ws.UserID == userID {
			result = append(result, ws)
		}
	}
	return result, nil
}

// Create appends a workspace to the mock store.
func (m *MockWorkspaceStore) Create(_ context.Context, ws model.Workspace) error {
	m.CreateCallCount++
	if m.CreateErr != nil {
		return m.CreateErr
	}
	m.Workspaces = append(m.Workspaces, ws)
	return nil
}

// Delete removes the workspace owned by userID, mirroring the real store's
// scoping: it returns workspace.ErrNotFound when no workspace matches both id
// and userID.
func (m *MockWorkspaceStore) Delete(_ context.Context, id, userID string) error {
	m.DeleteCallCount++
	if m.DeleteErr != nil {
		return m.DeleteErr
	}

	for i, ws := range m.Workspaces {
		if ws.ID == id && ws.UserID == userID {
			m.Workspaces = append(m.Workspaces[:i], m.Workspaces[i+1:]...)
			return nil
		}
	}
	return workspace.ErrNotFound
}

// NewTestWorkspace returns a Workspace fixture owned by the given user.
func NewTestWorkspace(id, userID string) model.Workspace {
	return model.Workspace{
		ID:      id,
		UserID:  userID,
		Name:    "test-workspace",
		Slug:    "test-workspace",
		Env:     "production",
		Role:    "Owner",
		Members: 1,
		Plan:    "Free",
	}
}

package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/tracium/api/internal/middleware"
	"github.com/tracium/api/internal/model"
	"github.com/tracium/api/testing/mocks"
)

// stubUserLookup satisfies handler.UserLookup for tests that don't exercise
// member-by-email resolution.
type stubUserLookup struct{}

func (stubUserLookup) ByEmail(context.Context, string) (*model.User, error) {
	return &model.User{ID: "user-b"}, nil
}

// stubAuthenticator authenticates every request as the given user, so the
// handler under test sees a Principal the way the middleware chain provides it.
type stubAuthenticator struct{ userID string }

func (a stubAuthenticator) Authenticate(context.Context, string) (*model.Principal, error) {
	return &model.Principal{UserID: a.userID, TenantID: "tenant-test", Role: "user"}, nil
}

// deleteWorkspace runs the Delete handler as the given user, carrying the {id}
// path param the way chi would.
func deleteWorkspace(h *WorkspaceHandler, id, userID string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodDelete, "/v1/workspaces/"+id, nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", id)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	rr := httptest.NewRecorder()
	middleware.Auth(stubAuthenticator{userID: userID})(http.HandlerFunc(h.Delete)).ServeHTTP(rr, req)
	return rr
}

func TestWorkspaceDelete(t *testing.T) {
	store := &mocks.MockWorkspaceStore{
		Workspaces: []model.Workspace{mocks.NewTestWorkspace("ws-1", "user-a")},
	}
	h := NewWorkspaceHandler(store, stubUserLookup{})

	rr := deleteWorkspace(h, "ws-1", "user-a")

	if rr.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rr.Code)
	}
	if len(store.Workspaces) != 0 {
		t.Errorf("workspace was not removed: %+v", store.Workspaces)
	}
}

func TestWorkspaceDeleteOtherUsersWorkspace(t *testing.T) {
	store := &mocks.MockWorkspaceStore{
		Workspaces: []model.Workspace{mocks.NewTestWorkspace("ws-1", "user-a")},
	}
	h := NewWorkspaceHandler(store, stubUserLookup{})

	rr := deleteWorkspace(h, "ws-1", "user-b")

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
	var body model.ErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Code != "WORKSPACE_NOT_FOUND" {
		t.Errorf("code = %q, want WORKSPACE_NOT_FOUND", body.Code)
	}
	if len(store.Workspaces) != 1 {
		t.Errorf("owner's workspace was removed: %+v", store.Workspaces)
	}
}

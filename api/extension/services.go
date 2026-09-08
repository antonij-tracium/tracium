// Package extension contains the narrow contracts available to application modules.
package extension

import (
	"context"
	"errors"
	"github.com/tracium/api/internal/middleware"
	"github.com/tracium/api/internal/model"
	"net/http"
)

type Principal = model.Principal

func PrincipalFromContext(ctx context.Context) (*Principal, bool) {
	return middleware.PrincipalFromContext(ctx)
}

type Message struct {
	// ID is a stable delivery key. Implementations should deduplicate retries.
	ID      string
	To      string
	Subject string
	Text    string
}
type Mailer interface {
	Send(context.Context, Message) error
}

var ErrMailDisabled = errors.New("email delivery is not configured")

type DisabledMailer struct{}

func (DisabledMailer) Send(context.Context, Message) error { return ErrMailDisabled }

type Subject struct {
	UserID      string
	WorkspaceID string
}
type Decision struct {
	Allowed bool   `json:"allowed"`
	Limit   *int64 `json:"limit,omitempty"`
}
type Entitlements interface {
	Check(context.Context, Subject, string) (Decision, error)
}
type CoreEntitlements struct{}

func (CoreEntitlements) Check(_ context.Context, _ Subject, feature string) (Decision, error) {
	return Decision{Allowed: feature == "traces.read" || feature == "metrics.read"}, nil
}

type WorkspaceAccess interface {
	AllowedIDs(context.Context, string) ([]string, error)
}
type Services struct {
	Mail         Mailer
	Entitlements Entitlements
	Workspaces   WorkspaceAccess
}

// RequireFeature checks workspace membership before consulting entitlements.
// Extension handlers still validate ownership of any additional objects they use.
// A missing workspace or provider failure never silently grants access.
func (s Services) RequireFeature(feature string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p, ok := PrincipalFromContext(r.Context())
			if !ok || p.UserID == "" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			id := r.URL.Query().Get("workspace_id")
			if id == "" {
				http.Error(w, "workspace_id is required", http.StatusBadRequest)
				return
			}
			if s.Workspaces == nil || s.Entitlements == nil {
				http.Error(w, "service unavailable", http.StatusServiceUnavailable)
				return
			}
			ids, err := s.Workspaces.AllowedIDs(r.Context(), p.UserID)
			if err != nil {
				http.Error(w, "service unavailable", http.StatusServiceUnavailable)
				return
			}
			allowed := false
			for _, candidate := range ids {
				if candidate == id {
					allowed = true
					break
				}
			}
			if !allowed {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			decision, err := s.Entitlements.Check(r.Context(), Subject{UserID: p.UserID, WorkspaceID: id}, feature)
			if err != nil {
				http.Error(w, "service unavailable", http.StatusServiceUnavailable)
				return
			}
			if !decision.Allowed {
				http.Error(w, "feature unavailable", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

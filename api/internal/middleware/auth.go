package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/tracium/api/internal/model"
)

// Authenticator validates a bearer token and returns the authenticated Principal.
// Swap the implementation in main.go to change auth strategy without touching handlers.
type Authenticator interface {
	Authenticate(ctx context.Context, token string) (*model.Principal, error)
}

type contextKey int

const principalKey contextKey = iota

// Auth returns a middleware that validates the Authorization: Bearer <token> header
// and injects the resulting Principal into the request context.
func Auth(authenticator Authenticator) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if header == "" {
				http.Error(w, `{"code":"UNAUTHORIZED","message":"missing authorization header"}`, http.StatusUnauthorized)
				return
			}

			const prefix = "Bearer "
			if !strings.HasPrefix(header, prefix) {
				http.Error(w, `{"code":"UNAUTHORIZED","message":"authorization header must use Bearer scheme"}`, http.StatusUnauthorized)
				return
			}

			token := strings.TrimPrefix(header, prefix)
			principal, err := authenticator.Authenticate(r.Context(), token)
			if err != nil {
				http.Error(w, `{"code":"UNAUTHORIZED","message":"invalid or expired token"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), principalKey, principal)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// PrincipalFromContext retrieves the authenticated Principal from the request context.
// Handlers can assume this is always set — the auth middleware ensures it.
func PrincipalFromContext(ctx context.Context) (*model.Principal, bool) {
	p, ok := ctx.Value(principalKey).(*model.Principal)
	return p, ok
}

// ContextWithPrincipal attaches a Principal to ctx exactly as the Auth
// middleware would. Exported so tests can exercise handlers that require an
// authenticated principal without wiring the full middleware chain.
func ContextWithPrincipal(ctx context.Context, p *model.Principal) context.Context {
	return context.WithValue(ctx, principalKey, p)
}

// NoopAuthenticator always succeeds and returns a default principal suitable for
// development and testing. Never use this in production.
type NoopAuthenticator struct{}

func (a *NoopAuthenticator) Authenticate(_ context.Context, _ string) (*model.Principal, error) {
	return &model.Principal{
		TenantID: "default",
		Role:     "admin",
	}, nil
}

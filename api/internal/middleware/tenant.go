package middleware

import (
	"context"
	"net/http"
)

type tenantContextKey int

const tenantKey tenantContextKey = iota

// TenantFromContext retrieves the tenant ID from the request context.
// Set by RequireTenant middleware after auth succeeds.
func TenantFromContext(ctx context.Context) (string, bool) {
	t, ok := ctx.Value(tenantKey).(string)
	if !ok || t == "" {
		return "", false
	}
	return t, true
}

// RequireTenant returns a middleware that extracts the tenant ID from the Principal
// (which must already be in context, set by the Auth middleware) and stores it
// separately for convenient access. Returns 401 if no principal is present.
func RequireTenant() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			principal, ok := PrincipalFromContext(r.Context())
			if !ok || principal == nil || principal.TenantID == "" {
				http.Error(w, `{"code":"UNAUTHORIZED","message":"tenant could not be resolved from credentials"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), tenantKey, principal.TenantID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tracium/api/internal/middleware"
	"github.com/tracium/api/internal/version"
)

func TestAPIVersionHeader(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"route prefix is stripped", version.V1, "v1"},
		{"bare version is unchanged", "v1", "v1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := middleware.APIVersion(tt.in)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))

			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/v1/health", nil))

			if got := rr.Header().Get("X-Tracium-API-Version"); got != tt.want {
				t.Errorf("X-Tracium-API-Version = %q, want %q", got, tt.want)
			}
		})
	}
}

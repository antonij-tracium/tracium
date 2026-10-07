package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tracium/api/internal/model"
)

type fakeAuthenticator struct{}

func (fakeAuthenticator) Authenticate(_ context.Context, token string) (*model.Principal, error) {
	if token == "good" {
		return &model.Principal{UserID: "u-1"}, nil
	}
	return nil, errors.New("bad token")
}

func TestAuth(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, ok := PrincipalFromContext(r.Context())
		if !ok || p.UserID != "u-1" {
			t.Error("principal missing from context")
		}
		w.WriteHeader(http.StatusNoContent)
	})
	for _, tt := range []struct {
		name, header string
		want         int
	}{
		{"missing header", "", http.StatusUnauthorized},
		{"other scheme", "Basic dTpw", http.StatusUnauthorized},
		{"invalid token", "Bearer bad", http.StatusUnauthorized},
		{"valid token", "Bearer good", http.StatusNoContent},
	} {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.header != "" {
				r.Header.Set("Authorization", tt.header)
			}
			w := httptest.NewRecorder()
			Auth(fakeAuthenticator{})(next).ServeHTTP(w, r)
			if w.Code != tt.want {
				t.Fatalf("status = %d, want %d", w.Code, tt.want)
			}
			if tt.want != http.StatusUnauthorized {
				return
			}
			var body model.ErrorResponse
			if w.Header().Get("Content-Type") != "application/json" || json.Unmarshal(w.Body.Bytes(), &body) != nil || body.Code != "UNAUTHORIZED" {
				t.Fatalf("not a JSON error: %q %s", w.Header().Get("Content-Type"), w.Body.String())
			}
		})
	}
}

package app

import (
	"github.com/go-chi/chi/v5"
	"github.com/tracium/api/extension"
	"github.com/tracium/api/internal/auth"
	"github.com/tracium/api/testing/mocks"
	"net/http"
	"net/http/httptest"
	"testing"
)

type repository struct {
	*mocks.MockTraceRepository
	*mocks.MockMetricsRepository
}

func TestExtensionsShareAuthAndCannotReplaceCoreRoutes(t *testing.T) {
	issuer := auth.NewTokenIssuer("test-only-secret")
	token, err := issuer.Issue("user", "tenant", "admin")
	if err != nil {
		t.Fatal(err)
	}
	var cfg Config
	cfg.Default()
	opts := Options{Extensions: []Extension{{Name: "example", Routes: func(r chi.Router, s extension.Services) {
		r.Get("/identity", func(w http.ResponseWriter, r *http.Request) {
			p, ok := extension.PrincipalFromContext(r.Context())
			if !ok || p.UserID != "user" {
				t.Error("missing shared identity")
			}
			w.WriteHeader(204)
		})
	}, Webhooks: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(202) })}}}
	repo := repository{mocks.NewMockTraceRepository(), &mocks.MockMetricsRepository{}}
	router := newRouter(cfg, repo, &mocks.MockWorkspaceStore{}, nil, issuer, auth.NewService(nil, issuer), nil, opts)
	for _, tt := range []struct {
		path, token string
		want        int
	}{
		{"/v1/extensions/example/identity", "", 401}, {"/v1/extensions/example/identity", "invalid", 401},
		{"/v1/extensions/example/identity", token, 204}, {"/v1/integrations/example", "", 202},
		{"/v1/workspaces", "", 401}, {"/v1/workspaces", token, 200}, {"/v1/health", "", 200},
	} {
		r := httptest.NewRequest("GET", tt.path, nil)
		if tt.token != "" {
			r.Header.Set("Authorization", "Bearer "+tt.token)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != tt.want {
			t.Errorf("%s: %d want %d", tt.path, w.Code, tt.want)
		}
	}
	if err = validateOptions(Options{Extensions: []Extension{{Name: "../auth"}}}); err == nil {
		t.Fatal("invalid route namespace accepted")
	}
}

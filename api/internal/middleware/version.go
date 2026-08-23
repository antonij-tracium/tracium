package middleware

import (
	"net/http"
	"strings"
)

// APIVersion returns a middleware that adds an X-Tracium-API-Version response
// header to every response, making it easy for clients to detect the served
// version. v may be given as a route prefix ("/v1"); the header carries the
// bare version ("v1").
func APIVersion(v string) func(http.Handler) http.Handler {
	v = strings.TrimPrefix(v, "/")
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Tracium-API-Version", v)
			next.ServeHTTP(w, r)
		})
	}
}

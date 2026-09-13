package traciumauthextension

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"go.opentelemetry.io/collector/client"
	"go.uber.org/zap"
)

// newTestAuth builds an extension pointed at a stub verify server.
func newTestAuth(t *testing.T, handler http.HandlerFunc) (*traciumAuth, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	cfg := &Config{
		Endpoint: srv.URL,
		Header:   "authorization",
		Scheme:   "Bearer",
		CacheTTL: time.Minute,
		Timeout:  2 * time.Second,
	}
	return newAuth(cfg, zap.NewNop()), srv
}

func TestAuthenticateValidKey(t *testing.T) {
	a, _ := newTestAuth(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"workspace_id":"ws-1"}`))
	})

	ctx, err := a.Authenticate(context.Background(), map[string][]string{
		"authorization": {"Bearer trc_deadbeef"},
	})
	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	auth := client.FromContext(ctx).Auth
	if auth == nil {
		t.Fatal("auth data not attached to client.Info")
	}
	if got := auth.GetAttribute(AttrWorkspace); got != "ws-1" {
		t.Fatalf("workspace = %v, want ws-1", got)
	}
}

// A verify response with no workspace is treated as a failure, not an accept.
func TestAuthenticateRejectsEmptyWorkspace(t *testing.T) {
	a, _ := newTestAuth(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"workspace_id":""}`))
	})
	if _, err := a.Authenticate(context.Background(), map[string][]string{
		"authorization": {"Bearer trc_x"},
	}); err == nil {
		t.Fatal("expected rejection when verify returns no workspace")
	}
}

func TestAuthenticateRejectsInvalidKey(t *testing.T) {
	a, _ := newTestAuth(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	if _, err := a.Authenticate(context.Background(), map[string][]string{
		"authorization": {"Bearer nope"},
	}); err == nil {
		t.Fatal("expected rejection")
	}
}

func TestAuthenticateMissingHeader(t *testing.T) {
	called := false
	a, _ := newTestAuth(t, func(w http.ResponseWriter, r *http.Request) { called = true })
	if _, err := a.Authenticate(context.Background(), map[string][]string{}); err == nil {
		t.Fatal("expected rejection for missing header")
	}
	if called {
		t.Fatal("verify endpoint must not be called when no key is presented")
	}
}

func TestVerifyCachesResult(t *testing.T) {
	var calls int32
	a, _ := newTestAuth(t, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		_, _ = w.Write([]byte(`{"workspace_id":"ws-1"}`))
	})
	sources := map[string][]string{"authorization": {"Bearer trc_cached"}}

	for i := 0; i < 3; i++ {
		if _, err := a.Authenticate(context.Background(), sources); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("expected 1 verify call with caching, got %d", got)
	}
}

// The cache is bounded: streaming more distinct tokens than the capacity must
// not grow it without limit — the least-recently-used entries are evicted.
func TestCacheEvictsBeyondCapacity(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"workspace_id":"ws-1"}`))
	}))
	t.Cleanup(srv.Close)
	a := newAuth(&Config{
		Endpoint: srv.URL, Header: "authorization", Scheme: "Bearer",
		CacheTTL: time.Minute, CacheMaxEntries: 2, Timeout: 2 * time.Second,
	}, zap.NewNop())

	for _, tok := range []string{"trc_a", "trc_b", "trc_c", "trc_d"} {
		if _, err := a.Authenticate(context.Background(), map[string][]string{
			"authorization": {"Bearer " + tok},
		}); err != nil {
			t.Fatalf("authenticate %s: %v", tok, err)
		}
	}

	a.mu.Lock()
	got := len(a.items)
	llLen := a.ll.Len()
	a.mu.Unlock()
	if got != 2 || llLen != 2 {
		t.Fatalf("cache size = %d (list %d), want capped at 2", got, llLen)
	}
}

// A positive entry past its TTL is a lookup miss (so the key is re-verified) but
// is retained as the last-known-good answer that lookupStale can serve if the
// verify backend is unreachable.
func TestCacheRetainsExpiredPositiveForStale(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"workspace_id":"ws-1"}`))
	}))
	t.Cleanup(srv.Close)
	a := newAuth(&Config{
		MaxStaleAge: time.Minute,
		Endpoint:    srv.URL, Header: "authorization", Scheme: "Bearer",
		CacheTTL: 10 * time.Millisecond, CacheMaxEntries: 10, Timeout: 2 * time.Second,
	}, zap.NewNop())

	if _, err := a.Authenticate(context.Background(), map[string][]string{
		"authorization": {"Bearer trc_x"},
	}); err != nil {
		t.Fatal(err)
	}

	time.Sleep(20 * time.Millisecond)
	key := cacheKeyFor("trc_x")
	// Past the TTL, lookup reports a miss so the key is re-verified when reachable.
	if _, ok := a.lookup(key); ok {
		t.Fatal("expired entry should not be a live hit")
	}
	// But it is retained: lookupStale returns it as the last-known-good answer.
	stale, ok := a.lookupStale(key)
	if !ok || stale.workspace != "ws-1" {
		t.Fatalf("stale lookup = %+v (present=%v), want ws-1", stale, ok)
	}
}

// A negative (rejection) entry is never served stale: a real "no" must expire on
// its short TTL rather than be extended by a backend outage.
func TestCacheDoesNotServeNegativeStale(t *testing.T) {
	a := newAuth(&Config{
		Header: "authorization", Scheme: "Bearer",
		CacheTTL: 10 * time.Millisecond, CacheMaxEntries: 10, Timeout: 2 * time.Second,
	}, zap.NewNop())

	key := cacheKeyFor("trc_bad")
	a.store(key, cacheEntry{ok: false})
	if _, ok := a.lookupStale(key); ok {
		t.Fatal("a rejection must not be served stale")
	}
}

// A key accepted once keeps working through a transient verify-backend outage:
// after its cached result lapses and the backend is unreachable, the extension
// serves the last-known-good workspace rather than rejecting. Rejecting would be
// a permanent, non-retryable drop of the sender's telemetry (the gRPC auth
// interceptor maps every error to Unauthenticated). A definitive 401 still
// rejects, so a key revoked while the backend is up is not served stale.
func TestServesStaleWhenBackendUnreachable(t *testing.T) {
	const (
		modeOK = iota
		mode500
		mode401
	)
	var mode atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch mode.Load() {
		case mode500:
			w.WriteHeader(http.StatusInternalServerError)
		case mode401:
			w.WriteHeader(http.StatusUnauthorized)
		default:
			_, _ = w.Write([]byte(`{"workspace_id":"ws-1"}`))
		}
	}))
	t.Cleanup(srv.Close)
	a := newAuth(&Config{
		MaxStaleAge: time.Minute,
		Endpoint:    srv.URL, Header: "authorization", Scheme: "Bearer",
		CacheTTL: 10 * time.Millisecond, Timeout: 2 * time.Second,
	}, zap.NewNop())

	hdr := map[string][]string{"authorization": {"Bearer trc_x"}}
	if _, err := a.Authenticate(context.Background(), hdr); err != nil {
		t.Fatalf("initial verify: %v", err)
	}

	// TTL lapses and the backend starts failing: the sender's in-flight data must
	// still be accepted on the last-known-good result.
	time.Sleep(20 * time.Millisecond)
	mode.Store(mode500)
	ctx, err := a.Authenticate(context.Background(), hdr)
	if err != nil {
		t.Fatalf("expected stale accept during outage, got %v", err)
	}
	if got := client.FromContext(ctx).Auth.GetAttribute(AttrWorkspace); got != "ws-1" {
		t.Fatalf("stale workspace = %v, want ws-1", got)
	}

	// A definitive 401 is a real rejection, not an outage: never served stale.
	time.Sleep(20 * time.Millisecond)
	mode.Store(mode401)
	if _, err := a.Authenticate(context.Background(), hdr); err == nil {
		t.Fatal("a 401 must reject even when a stale positive exists")
	}
}

// During a sustained outage the served-stale result is re-cached, so repeated
// requests are served from the cache rather than each re-probing the (down)
// backend — one probe per short-TTL window, not one per request. This keeps
// outage requests fast and stops the sender limiter from being charged (and
// eventually rejecting) a sender we are trying to keep alive.
func TestStaleServeIsCachedDuringOutage(t *testing.T) {
	var calls atomic.Int32
	var down atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if down.Load() {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_, _ = w.Write([]byte(`{"workspace_id":"ws-1"}`))
	}))
	t.Cleanup(srv.Close)
	// A one-second TTL keeps the whole loop inside a single stale-probe window;
	// the seed entry is force-expired below so timing never decides the outcome.
	a := newAuth(&Config{
		MaxStaleAge: time.Minute,
		Endpoint:    srv.URL, Header: "authorization", Scheme: "Bearer",
		CacheTTL: time.Second, Timeout: 2 * time.Second,
		// A tight per-sender budget: if each outage request charged it, the sender
		// would be rejected — the pre-fix behaviour this guards against.
		SenderVerifyLimit: 2, SenderVerifyWindow: time.Minute,
	}, zap.NewNop())

	hdr := map[string][]string{"authorization": {"Bearer trc_x"}}
	if _, err := a.Authenticate(context.Background(), hdr); err != nil {
		t.Fatalf("initial verify: %v", err)
	}
	// Expire the cached positive so the first outage request re-probes, without
	// relying on wall-clock timing.
	a.mu.Lock()
	a.items[cacheKeyFor("trc_x")].Value.(*cacheNode).entry.expires = time.Now().Add(-time.Hour)
	a.mu.Unlock()
	down.Store(true)
	calls.Store(0)

	// First outage request re-probes once and re-caches the stale result; the rest
	// are served from cache within the short-TTL window.
	for i := 0; i < 10; i++ {
		ctx, err := a.Authenticate(context.Background(), hdr)
		if err != nil {
			t.Fatalf("request %d rejected during outage: %v", i, err)
		}
		if got := client.FromContext(ctx).Auth.GetAttribute(AttrWorkspace); got != "ws-1" {
			t.Fatalf("request %d workspace = %v, want ws-1", i, got)
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("verify probes during outage = %d, want 1 (rest served from cache)", got)
	}
}

// Concurrent requests bearing the same uncached key are coalesced into a single
// verification, so a legitimate burst for one new key neither multiplies verify
// traffic nor spends the sender's per-key budget once per request.
func TestConcurrentVerifyCoalescesToOneCall(t *testing.T) {
	var calls atomic.Int32
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		<-release // hold the first call open so the rest pile up behind it
		_, _ = w.Write([]byte(`{"workspace_id":"ws-1"}`))
	}))
	t.Cleanup(srv.Close)
	a := newAuth(&Config{
		Endpoint: srv.URL, Header: "authorization", Scheme: "Bearer",
		CacheTTL: time.Minute, Timeout: 2 * time.Second,
	}, zap.NewNop())

	hdr := map[string][]string{"authorization": {"Bearer trc_x"}}
	const n = 8
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		go func() {
			_, err := a.Authenticate(context.Background(), hdr)
			errs <- err
		}()
	}
	// Let the goroutines arrive and coalesce behind the held call, then release it.
	time.Sleep(50 * time.Millisecond)
	close(release)

	for i := 0; i < n; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("coalesced request failed: %v", err)
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("verify API calls = %d, want 1 — concurrent misses must coalesce", got)
	}
}

func TestExtractKeyStripsScheme(t *testing.T) {
	a := newAuth(&Config{Header: "authorization", Scheme: "Bearer"}, zap.NewNop())
	for name, tc := range map[string]struct {
		sources map[string][]string
		want    string
	}{
		"bearer prefix":     {map[string][]string{"authorization": {"Bearer trc_abc"}}, "trc_abc"},
		"case-insensitive":  {map[string][]string{"Authorization": {"bearer trc_abc"}}, "trc_abc"},
		"no scheme present": {map[string][]string{"authorization": {"trc_abc"}}, "trc_abc"},
		"absent header":     {map[string][]string{}, ""},
	} {
		if got := a.extractKey(tc.sources); got != tc.want {
			t.Errorf("%s: got %q want %q", name, got, tc.want)
		}
	}
}

func TestConfigValidate(t *testing.T) {
	base := func() *Config {
		return &Config{Endpoint: "http://api:8080/v1/ingest/keys/verify", Header: "authorization", Timeout: time.Second}
	}
	if err := base().Validate(); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
	bad := base()
	bad.Endpoint = ""
	if err := bad.Validate(); err == nil {
		t.Error("empty endpoint accepted")
	}
	bad = base()
	bad.Endpoint = "ftp://nope"
	if err := bad.Validate(); err == nil {
		t.Error("non-http endpoint accepted")
	}
	bad = base()
	bad.Timeout = 0
	if err := bad.Validate(); err == nil {
		t.Error("zero timeout accepted")
	}
}

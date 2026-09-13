package traciumauthextension

import (
	"bytes"
	"container/list"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/collector/client"
	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension/auth"
	"go.uber.org/zap"
	"google.golang.org/grpc/peer"
)

// errUnauthenticated is returned for any request the extension rejects. The
// caller (a receiver's auth interceptor) turns it into the transport's
// unauthenticated status; the detail is logged, not returned to the sender.
var errUnauthenticated = errors.New("ingest key rejected")

// AttrWorkspace is the attribute name under which the verified key's workspace
// (a string) is attached to client.Info. It is a wire contract with the tracium
// processor, which reads it by the same key to stamp that workspace onto every
// span the request carries — the key, not the payload, decides where data lands.
const AttrWorkspace = "tracium.workspace"

// authData carries the verified workspace downstream via client.Info.Auth. It
// implements client.AuthData so the processor can read the workspace without
// importing this package.
type authData struct {
	workspace string
}

func (a authData) GetAttribute(name string) any {
	if name == AttrWorkspace {
		return a.workspace
	}
	return nil
}

func (a authData) GetAttributeNames() []string {
	return []string{AttrWorkspace}
}

// defaultCacheMaxEntries bounds the verification cache when Config.CacheMaxEntries
// is not set. It is a ceiling on distinct tokens held in memory, not a tuning
// target — the number of genuinely active keys is far below it. The point is
// that a bound exists: the cache is keyed by a sender-supplied token, so an
// unbounded cache is a memory-exhaustion vector. Mirrors user.DefaultCacheSize.
const defaultCacheMaxEntries = 10_000

// shortCacheTTL is the reduced cache lifetime for results that must be
// re-checked soon: a rejection (so a revoked-then-restored key self-heals) and a
// served-stale positive (so the verify backend is re-probed during an outage).
// It is capped at the configured CacheTTL, never longer.
const shortCacheTTL = 5 * time.Second

// traciumAuth implements auth.Server by verifying a presented ingest key against
// the Tracium API. Verifications are memoised in a bounded LRU cache.
type traciumAuth struct {
	cfg    *Config
	logger *zap.Logger
	client *http.Client

	capacity int

	// senderLimiter throttles how many API verify calls one sender can force in a
	// window (nil when disabled). It guards the collector's shared verify budget
	// against a single sender streaming distinct, uncacheable keys.
	senderLimiter *senderLimiter

	mu    sync.Mutex
	ll    *list.List               // front = most recently used
	items map[string]*list.Element // sha256(token) → element holding *cacheNode

	// inflight coalesces concurrent verifications of the same key. A burst of
	// requests bearing one not-yet-cached key becomes a single API call whose
	// result they all share, instead of each charging the sender's verify budget
	// and hitting the API. Guarded by its own mutex so the shared LRU lock is
	// never held across the network call.
	inflightMu sync.Mutex
	inflight   map[string]*verifyCall
}

// verifyCall is one in-flight verification shared by every request that arrived
// for the same key while it was running. done is closed when v/err are final.
type verifyCall struct {
	done chan struct{}
	v    verified
	err  error
}

// cacheNode is one LRU entry: its cache key plus the memoised verification.
type cacheNode struct {
	cacheKey string
	entry    cacheEntry
}

// cacheEntry is a memoised verification. A negative result (ok=false) is cached
// too, briefly, so a flood of the same bad key does not hammer the API.
type cacheEntry struct {
	workspace  string
	ok         bool
	expires    time.Time
	verifiedAt time.Time
}

// verified is the successful result of a key check: the workspace the key grants.
type verified struct {
	workspace string
}

var _ auth.Server = (*traciumAuth)(nil)

func newAuth(cfg *Config, logger *zap.Logger) *traciumAuth {
	capacity := cfg.CacheMaxEntries
	if capacity <= 0 {
		capacity = defaultCacheMaxEntries
	}
	return &traciumAuth{
		cfg:           cfg,
		logger:        logger,
		client:        &http.Client{Timeout: cfg.Timeout},
		capacity:      capacity,
		senderLimiter: newSenderLimiter(cfg.SenderVerifyLimit, cfg.SenderVerifyWindow),
		ll:            list.New(),
		items:         make(map[string]*list.Element, capacity),
		inflight:      make(map[string]*verifyCall),
	}
}

// Start implements component.Component. There is nothing to warm up; the verify
// endpoint is called lazily on the first request.
func (a *traciumAuth) Start(context.Context, component.Host) error { return nil }

// Shutdown implements component.Component.
func (a *traciumAuth) Shutdown(context.Context) error { return nil }

// Authenticate implements auth.Server. It extracts the ingest key from the
// configured header, verifies it (via cache or the API), and on success returns
// a context whose client.Info carries the workspace the key grants, so the
// processor can stamp it onto every span.
func (a *traciumAuth) Authenticate(ctx context.Context, sources map[string][]string) (context.Context, error) {
	token := a.extractKey(sources)
	if token == "" {
		a.logger.Debug("ingest request missing key header", zap.String("header", a.cfg.Header))
		return ctx, errUnauthenticated
	}

	v, err := a.verify(ctx, token, senderOf(ctx))
	if err != nil {
		// A transport/endpoint failure is distinct from a rejected key: log it so
		// an operator can tell "API unreachable" from "bad key". Either way the
		// request is refused — failing open would defeat the point of the gate.
		if errors.Is(err, errUnauthenticated) {
			a.logger.Debug("ingest key rejected")
		} else {
			a.logger.Warn("ingest key verification failed", zap.Error(err))
		}
		return ctx, errUnauthenticated
	}

	// Augment the existing client.Info (peer address, metadata) rather than
	// replacing it, so downstream components still see who connected.
	info := client.FromContext(ctx)
	info.Auth = authData{workspace: v.workspace}
	return client.NewContext(ctx, info), nil
}

// senderOf identifies the sender for per-sender limiting: the peer host off
// client.Info, with the port stripped so every connection from one source shares
// a bucket. When no peer address is available (some transports omit it) it
// returns a fixed key, so those requests share one bucket rather than escaping
// the limit entirely.
func senderOf(ctx context.Context) string {
	addr := client.FromContext(ctx).Addr
	if addr == nil {
		// On gRPC the auth interceptor runs before the collector populates
		// client.Info.Addr, so it is nil here for every gRPC request — which would
		// collapse all gRPC senders into one shared bucket. The gRPC peer is already
		// on the context at auth time, so fall back to it.
		if p, ok := peer.FromContext(ctx); ok && p.Addr != nil {
			addr = p.Addr
		}
	}
	if addr == nil {
		return "unknown"
	}
	s := addr.String()
	if host, _, err := net.SplitHostPort(s); err == nil {
		return host
	}
	return s
}

// extractKey pulls the key out of the configured header, tolerating the header
// name's case and stripping the optional scheme (e.g. "Bearer ").
func (a *traciumAuth) extractKey(sources map[string][]string) string {
	values := headerLookup(sources, a.cfg.Header)
	if len(values) == 0 {
		return ""
	}
	raw := strings.TrimSpace(values[0])
	if a.cfg.Scheme != "" {
		// Case-insensitive scheme match, then trim it and the following space.
		prefix := a.cfg.Scheme + " "
		if len(raw) >= len(prefix) && strings.EqualFold(raw[:len(prefix)], prefix) {
			raw = strings.TrimSpace(raw[len(prefix):])
		}
	}
	return raw
}

// headerLookup finds a header by name, case-insensitively, since gRPC metadata
// keys are lower-cased while HTTP headers are canonicalised.
func headerLookup(sources map[string][]string, name string) []string {
	if v, ok := sources[name]; ok {
		return v
	}
	if v, ok := sources[strings.ToLower(name)]; ok {
		return v
	}
	for k, v := range sources {
		if strings.EqualFold(k, name) {
			return v
		}
	}
	return nil
}

// verify resolves a token to the workspace it grants, using the cache when
// possible and otherwise calling the API. errUnauthenticated means the key is
// invalid; any other error means the check could not be completed.
func (a *traciumAuth) verify(ctx context.Context, token, sender string) (verified, error) {
	if err := ctx.Err(); err != nil {
		return verified{}, err
	}
	cacheKey := cacheKeyFor(token)

	// Fast path: a live cache entry answers without touching the single-flight map.
	if v, ok, err := a.cachedResult(cacheKey); ok {
		return v, err
	}

	// Coalesce concurrent misses for the same key. The first caller leads and
	// performs the verification; callers that arrive while it runs wait for and
	// share its result, so one uncached key costs one API call and one unit of the
	// sender's budget however many requests carry it at once.
	call, leader := a.joinInflight(cacheKey)
	if !leader {
		select {
		case <-call.done:
			return call.v, call.err
		case <-ctx.Done():
			return verified{}, ctx.Err()
		}
	}
	defer a.finishInflight(cacheKey, call)

	call.v, call.err = a.doVerify(ctx, cacheKey, token, sender)
	return call.v, call.err
}

// doVerify performs one verification as the in-flight leader: it re-checks the
// cache, charges the sender budget, calls the API, and memoises the outcome.
func (a *traciumAuth) doVerify(ctx context.Context, cacheKey, token, sender string) (verified, error) {
	// A concurrent leader may have populated the cache between our miss and our
	// becoming leader; prefer that result over a fresh call.
	if v, ok, err := a.cachedResult(cacheKey); ok {
		return v, err
	}

	// Only cache misses reach the API, so the per-sender budget is charged here,
	// not on cache hits: a sender presenting one valid key pays once and is then
	// served from cache. A sender that exhausts its budget is rejected without a
	// call, so it cannot spend the collector's shared verify allowance on the API.
	if !a.senderLimiter.allow(sender) {
		a.logger.Warn("sender exceeded verification rate; rejecting without calling API",
			zap.String("sender", sender))
		return verified{}, errUnauthenticated
	}

	v, err := a.callVerify(ctx, token)
	// A disconnected caller is not evidence of a backend outage. In particular,
	// it must not turn an expired authorization into a fresh positive cache hit.
	// Check before handling either errors or success, including cancellation that
	// raced with receipt of the verification response.
	if ctxErr := ctx.Err(); ctxErr != nil {
		return verified{}, ctxErr
	}
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return verified{}, err
		}
		if errors.Is(err, errUnauthenticated) {
			// A real rejection: cache it (briefly) and reject.
			a.store(cacheKey, cacheEntry{ok: false})
			return verified{}, err
		}
		// Not a rejection — the verify backend was unreachable (transport error or
		// 5xx). The gRPC auth interceptor collapses every error we return here to
		// codes.Unauthenticated, which OTLP senders treat as permanent and will not
		// retry, so returning this error would turn a brief verify outage into
		// permanent loss of a sender's in-flight telemetry. Ride the outage out on
		// the last-known-good result when we have one: this never invents trust —
		// only a key the backend previously accepted is honoured, and only within
		// the operator's explicit max_stale_age. Stale trust is disabled by default.
		if stale, ok := a.lookupStale(cacheKey); ok {
			a.logger.Warn("verify endpoint unreachable; serving last cached result for key",
				zap.Error(err))
			// Re-cache briefly so the rest of the outage is served from lookup rather
			// than every request paying the verify timeout and a sender-budget charge
			// (which, once exhausted, would reject the very sender we are protecting).
			a.storeStale(cacheKey, stale)
			return verified{workspace: stale.workspace}, nil
		}
		return verified{}, err
	}
	a.store(cacheKey, cacheEntry{workspace: v.workspace, ok: true})
	return v, nil
}

// joinInflight registers interest in verifying cacheKey. It returns the shared
// call and whether this caller is the leader (responsible for doing the work and
// calling finishInflight); a false leader must wait on call.done.
func (a *traciumAuth) joinInflight(cacheKey string) (*verifyCall, bool) {
	a.inflightMu.Lock()
	defer a.inflightMu.Unlock()
	if call, ok := a.inflight[cacheKey]; ok {
		return call, false
	}
	call := &verifyCall{done: make(chan struct{})}
	a.inflight[cacheKey] = call
	return call, true
}

// finishInflight publishes the leader's result to any waiters and clears the
// slot so the next miss starts a fresh call.
func (a *traciumAuth) finishInflight(cacheKey string, call *verifyCall) {
	a.inflightMu.Lock()
	delete(a.inflight, cacheKey)
	a.inflightMu.Unlock()
	close(call.done)
}

// cachedResult reports a memoised verification for cacheKey when a live entry
// exists: ok is whether the cache decided the request, and (verified, error) is
// that decision — a workspace for a positive entry, errUnauthenticated for a
// cached rejection. A miss returns ok=false and the caller must verify.
func (a *traciumAuth) cachedResult(cacheKey string) (verified, bool, error) {
	entry, ok := a.lookup(cacheKey)
	if !ok {
		return verified{}, false, nil
	}
	if entry.ok {
		return verified{workspace: entry.workspace}, true, nil
	}
	return verified{}, true, errUnauthenticated
}

func (a *traciumAuth) lookup(cacheKey string) (cacheEntry, bool) {
	if a.cfg.CacheTTL <= 0 {
		return cacheEntry{}, false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	el, ok := a.items[cacheKey]
	if !ok {
		return cacheEntry{}, false
	}
	node := el.Value.(*cacheNode)
	if time.Now().After(node.entry.expires) {
		// Report a miss so the key is re-verified, but keep the entry in place: a
		// positive entry is retained as the last-known-good answer that lookupStale
		// falls back on when the verify backend is unreachable. It is refreshed on
		// the next successful verify and reclaimed by LRU eviction otherwise, so it
		// does not grow the cache.
		return cacheEntry{}, false
	}
	a.ll.MoveToFront(el)
	return node.entry, true
}

// lookupStale returns the last cached positive result within the explicitly
// configured absolute age limit, without disturbing LRU order. It backs the fallback in
// doVerify: a rejection (ok=false) is never served stale — a real "no" must
// expire on its short TTL rather than be extended by a backend outage.
func (a *traciumAuth) lookupStale(cacheKey string) (cacheEntry, bool) {
	if a.cfg.CacheTTL <= 0 || a.cfg.MaxStaleAge <= 0 {
		return cacheEntry{}, false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	el, ok := a.items[cacheKey]
	if !ok {
		return cacheEntry{}, false
	}
	entry := el.Value.(*cacheNode).entry
	if !entry.ok || entry.verifiedAt.IsZero() || !time.Now().Before(entry.verifiedAt.Add(a.cfg.MaxStaleAge)) {
		return cacheEntry{}, false
	}
	return entry, true
}

func (a *traciumAuth) store(cacheKey string, entry cacheEntry) {
	if a.cfg.CacheTTL <= 0 {
		return
	}
	ttl := a.cfg.CacheTTL
	if entry.ok {
		entry.verifiedAt = time.Now()
	}
	if !entry.ok {
		// Negative results expire faster so a key revoked-then-fixed, or the API
		// being briefly wrong, self-heals quickly. Cap at the configured TTL.
		ttl = a.shortTTL()
	}
	a.storeWithTTL(cacheKey, entry, ttl)
}

// storeStale re-caches a served-stale positive with the short TTL, so repeated
// requests during a backend outage are served straight from lookup — without a
// per-request verify timeout, an API call, or a sender-budget charge — while the
// backend is still re-probed every shortTTL so a recovery (and any revocation)
// is picked up promptly.
func (a *traciumAuth) storeStale(cacheKey string, entry cacheEntry) {
	if a.cfg.CacheTTL <= 0 || a.cfg.MaxStaleAge <= 0 {
		return
	}
	// Re-probes never advance verifiedAt or let a live cache hit outlast the
	// absolute trust deadline, even if the outage continues indefinitely.
	now := time.Now()
	deadline := entry.verifiedAt.Add(a.cfg.MaxStaleAge)
	if now.Before(deadline) {
		entry.expires = now.Add(a.shortTTL())
		if entry.expires.After(deadline) {
			entry.expires = deadline
		}
		a.storeEntry(cacheKey, entry)
	}
}

// shortTTL is the reduced lifetime used for results that must be re-checked
// soon: negative (rejection) entries and served-stale positives. It is the fixed
// re-probe interval, capped at the configured TTL so it is never longer.
func (a *traciumAuth) shortTTL() time.Duration {
	if shortCacheTTL < a.cfg.CacheTTL {
		return shortCacheTTL
	}
	return a.cfg.CacheTTL
}

func (a *traciumAuth) storeWithTTL(cacheKey string, entry cacheEntry, ttl time.Duration) {
	entry.expires = time.Now().Add(ttl)
	a.storeEntry(cacheKey, entry)
}

func (a *traciumAuth) storeEntry(cacheKey string, entry cacheEntry) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if el, ok := a.items[cacheKey]; ok {
		el.Value.(*cacheNode).entry = entry
		a.ll.MoveToFront(el)
		return
	}
	a.items[cacheKey] = a.ll.PushFront(&cacheNode{cacheKey: cacheKey, entry: entry})
	// Evict the least-recently-used entry once over capacity, so a stream of
	// distinct (e.g. invalid) tokens cannot grow memory without bound.
	if a.ll.Len() > a.capacity {
		if back := a.ll.Back(); back != nil {
			a.removeElement(back)
		}
	}
}

// removeElement drops one element from both the list and the index. Callers must
// hold a.mu.
func (a *traciumAuth) removeElement(el *list.Element) {
	a.ll.Remove(el)
	delete(a.items, el.Value.(*cacheNode).cacheKey)
}

// cacheKeyFor derives the cache key for a token. It is the token's hash, so the
// map never holds plaintext tokens.
func cacheKeyFor(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// verifyRequest/verifyResponse mirror the API's /v1/ingest/keys/verify contract.
type verifyRequest struct {
	Key string `json:"key"`
}

type verifyResponse struct {
	WorkspaceID string `json:"workspace_id"`
}

// callVerify performs the HTTP call to the API's verify endpoint.
func (a *traciumAuth) callVerify(ctx context.Context, token string) (verified, error) {
	body, err := json.Marshal(verifyRequest{Key: token})
	if err != nil {
		return verified{}, fmt.Errorf("marshal verify request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.Endpoint, bytes.NewReader(body))
	if err != nil {
		return verified{}, fmt.Errorf("build verify request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		return verified{}, fmt.Errorf("call verify endpoint: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		var vr verifyResponse
		if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&vr); err != nil {
			return verified{}, fmt.Errorf("decode verify response: %w", err)
		}
		if vr.WorkspaceID == "" {
			return verified{}, errors.New("verify endpoint returned empty workspace_id")
		}
		return verified{workspace: vr.WorkspaceID}, nil
	case http.StatusUnauthorized:
		return verified{}, errUnauthenticated
	default:
		return verified{}, fmt.Errorf("verify endpoint returned status %d", resp.StatusCode)
	}
}

package traciumauthextension

import (
	"errors"
	"fmt"
	"net/url"
	"time"
)

// Config configures the Tracium ingest-auth extension.
//
// The extension holds no keys itself: it forwards the credential presented on
// each ingest request to the API's verify endpoint (which owns the key store in
// Postgres) and caches the answer briefly. That keeps per-client key logic in
// one place — the API — while the collector stays a generic OTel distribution.
type Config struct {
	// Endpoint is the API's key-verification URL, e.g.
	// http://api:8080/v1/ingest/keys/verify. Required.
	Endpoint string `mapstructure:"endpoint"`

	// Header names the request header carrying the ingest key. Defaults to
	// "authorization" so senders can use the standard
	// OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <key>".
	Header string `mapstructure:"header"`

	// Scheme, when set, is stripped from the header value before verification
	// (e.g. "Bearer"). Defaults to "Bearer"; set to "" to treat the whole header
	// value as the key.
	Scheme string `mapstructure:"scheme"`

	// CacheTTL is how long a successful verification is trusted before the key is
	// re-checked against the API. Bounds how long a revoked key keeps working;
	// keep it short. Defaults to 60s. Zero disables caching.
	CacheTTL time.Duration `mapstructure:"cache_ttl"`
	// MaxStaleAge optionally permits outage fallback until this much time has
	// elapsed since the last successful verification. Zero (default) disables
	// stale authorization, preserving CacheTTL as the revocation bound.
	MaxStaleAge time.Duration `mapstructure:"max_stale_age"`

	// CacheMaxEntries bounds how many distinct verifications are held in memory.
	// The bound is a security control, not just hygiene: the cache is keyed by a
	// sender-supplied token, so without a cap any client could grow the
	// collector's memory without limit by streaming distinct (mostly invalid)
	// keys. Once full, the least-recently-used entry is evicted. Defaults to
	// 10000; a value <= 0 uses the default.
	CacheMaxEntries int `mapstructure:"cache_max_entries"`

	// Timeout bounds each call to the verify endpoint. Defaults to 5s.
	Timeout time.Duration `mapstructure:"timeout"`

	// SenderVerifyLimit caps how many verification calls a single sender (peer
	// address) can force against the API within SenderVerifyWindow. Only cache
	// misses count, so a sender presenting one valid key is charged once and then
	// served from cache — legitimate high-volume ingest is unaffected. It exists
	// to stop one abusive sender, streaming distinct invalid keys, from spending
	// the collector's shared verify budget and blocking everyone else behind the
	// same collector. Defaults to 20; a value <= 0 disables per-sender limiting.
	SenderVerifyLimit int `mapstructure:"sender_verify_limit"`

	// SenderVerifyWindow is the window over which SenderVerifyLimit is counted.
	// Defaults to 1m. Ignored when SenderVerifyLimit is disabled.
	SenderVerifyWindow time.Duration `mapstructure:"sender_verify_window"`
}

// Validate implements component.ConfigValidator.
func (c *Config) Validate() error {
	if c.Endpoint == "" {
		return errors.New("endpoint is required")
	}
	u, err := url.Parse(c.Endpoint)
	if err != nil {
		return fmt.Errorf("endpoint is not a valid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("endpoint must be an http(s) URL, got %q", c.Endpoint)
	}
	if c.Header == "" {
		return errors.New("header must not be empty")
	}
	if c.CacheTTL < 0 {
		return errors.New("cache_ttl must not be negative")
	}
	if c.MaxStaleAge < 0 {
		return errors.New("max_stale_age must not be negative")
	}
	if c.Timeout <= 0 {
		return errors.New("timeout must be positive")
	}
	if c.SenderVerifyLimit > 0 && c.SenderVerifyWindow <= 0 {
		return errors.New("sender_verify_window must be positive when sender_verify_limit is set")
	}
	return nil
}

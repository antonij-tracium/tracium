package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// Authentication modes, selected by auth.mode / AUTH_MODE.
const (
	// AuthModeJWT verifies the tokens issued by /v1/auth/login against the
	// accounts stored in Postgres. This is the default.
	AuthModeJWT = "jwt"
	// AuthModeNone disables authentication entirely: every request is granted
	// the admin role. It must be asked for by name and is never a fallback for
	// missing or misspelled configuration.
	AuthModeNone = "none"
)

// insecureJWTSecret is the value this repository used to default to. Tracium is
// OSS, so the string is public and tokens signed with it are forgeable by
// anyone — Validate rejects it.
const insecureJWTSecret = "dev-insecure-secret-change-me"

// secretHint is appended to jwt_secret errors so the operator can fix the
// deploy without leaving the log line.
const secretHint = "generate one with: openssl rand -hex 32"

// ServerConfig holds HTTP server configuration.
type ServerConfig struct {
	Addr                string `yaml:"addr"`
	HealthAddr          string `yaml:"health_addr"`
	ReadTimeoutSeconds  int    `yaml:"read_timeout_seconds"`
	WriteTimeoutSeconds int    `yaml:"write_timeout_seconds"`
}

// StorageConfig holds database connection strings.
type StorageConfig struct {
	ClickHouseDSN string `yaml:"clickhouse_dsn"`
	PostgresDSN   string `yaml:"postgres_dsn"`
	QueryTimeout  int    `yaml:"query_timeout_seconds"`
}

// AuthConfig holds authentication settings.
type AuthConfig struct {
	Mode        string `yaml:"mode"` // AuthModeJWT or AuthModeNone
	TokenHeader string `yaml:"token_header"`
	JWTSecret   string `yaml:"jwt_secret"`
	// RateLimitPerMinute caps register/login attempts per client IP per minute.
	// Defaults to 10; set a negative value to disable throttling entirely.
	RateLimitPerMinute int `yaml:"rate_limit_per_minute"`
	// VerifyRateLimitPerMinute caps ingest-key verification attempts per client
	// IP per minute. It is kept separate from RateLimitPerMinute on purpose: the
	// verify endpoint's caller is a collector (machine traffic, one IP fronting
	// many senders), so it needs a larger, dedicated allowance. Sharing the tiny
	// login bucket let a handful of invalid keys exhaust the collector's budget
	// and starve verification of legitimate keys. Defaults to 120; a negative
	// value disables throttling of the verify endpoint.
	VerifyRateLimitPerMinute int `yaml:"verify_rate_limit_per_minute"`
	// TrustedProxies lists IPs/CIDRs or dns:service-name entries for proxies allowed to set
	// X-Forwarded-For for the rate limiter. Empty (the default) means the header
	// is ignored and the socket peer is always used, so a direct client cannot
	// spoof its source IP. Set this to your ingress/proxy network only when that
	// proxy overwrites the header from untrusted input.
	TrustedProxies []string `yaml:"trusted_proxies"`
}

// TelemetryConfig holds logging and observability settings.
type TelemetryConfig struct {
	LogLevel  string `yaml:"log_level"`
	LogFormat string `yaml:"log_format"`
}

// Config is the top-level application configuration.
type Config struct {
	Server    ServerConfig    `yaml:"server"`
	Storage   StorageConfig   `yaml:"storage"`
	Auth      AuthConfig      `yaml:"auth"`
	Telemetry TelemetryConfig `yaml:"telemetry"`
}

// Default populates Config with sensible defaults.
// Call this before Validate() and before overriding with environment-specific values.
func (c *Config) Default() {
	if c.Server.Addr == "" {
		c.Server.Addr = ":8090"
	}
	if c.Server.HealthAddr == "" {
		c.Server.HealthAddr = ":8091"
	}
	if c.Server.ReadTimeoutSeconds == 0 {
		c.Server.ReadTimeoutSeconds = 30
	}
	if c.Server.WriteTimeoutSeconds == 0 {
		c.Server.WriteTimeoutSeconds = 30
	}
	if c.Storage.QueryTimeout == 0 {
		c.Storage.QueryTimeout = 10
	}
	if c.Auth.Mode == "" {
		c.Auth.Mode = AuthModeJWT
	}
	if c.Auth.TokenHeader == "" {
		c.Auth.TokenHeader = "Authorization"
	}
	if c.Auth.RateLimitPerMinute == 0 {
		c.Auth.RateLimitPerMinute = 10
	}
	if c.Auth.VerifyRateLimitPerMinute == 0 {
		c.Auth.VerifyRateLimitPerMinute = 120
	}
	// auth.jwt_secret is deliberately not defaulted: a signing secret shared by
	// every install is no secret at all. Absence must fail the deploy.
	if c.Telemetry.LogLevel == "" {
		c.Telemetry.LogLevel = "info"
	}
	if c.Telemetry.LogFormat == "" {
		c.Telemetry.LogFormat = "json"
	}
}

// Validate checks the HTTP server settings.
func (c *ServerConfig) Validate() error {
	var errs []error
	if c.Addr == "" {
		errs = append(errs, errors.New("config: server.addr is required (set LISTEN_ADDR)"))
	}
	if c.ReadTimeoutSeconds <= 0 {
		errs = append(errs, errors.New("config: server.read_timeout_seconds must be positive"))
	}
	if c.WriteTimeoutSeconds <= 0 {
		errs = append(errs, errors.New("config: server.write_timeout_seconds must be positive"))
	}
	return errors.Join(errs...)
}

// Validate checks the storage settings. Both DSNs are required: the API cannot
// serve traces without ClickHouse, and cannot authenticate anyone without the
// accounts in Postgres. Starting without either would fail open.
func (c *StorageConfig) Validate() error {
	var errs []error
	if c.ClickHouseDSN == "" {
		errs = append(errs, errors.New("config: storage.clickhouse_dsn is required (set CLICKHOUSE_DSN)"))
	}
	if c.PostgresDSN == "" {
		errs = append(errs, errors.New("config: storage.postgres_dsn is required (set POSTGRES_DSN)"))
	}
	if c.QueryTimeout <= 0 {
		errs = append(errs, errors.New("config: storage.query_timeout_seconds must be positive"))
	}
	return errors.Join(errs...)
}

// Validate checks the auth settings. A missing signing secret is an error in
// every mode — the login and register routes issue tokens regardless of mode.
func (c *AuthConfig) Validate() error {
	var errs []error
	if c.Mode != AuthModeJWT && c.Mode != AuthModeNone {
		errs = append(errs, fmt.Errorf("config: auth.mode must be %q or %q, got %q (set AUTH_MODE)", AuthModeJWT, AuthModeNone, c.Mode))
	}
	switch c.JWTSecret {
	case "":
		errs = append(errs, fmt.Errorf("config: auth.jwt_secret is required (set JWT_SECRET) — %s", secretHint))
	case insecureJWTSecret:
		errs = append(errs, fmt.Errorf("config: auth.jwt_secret is the published example value, so anyone can forge admin tokens — %s", secretHint))
	}
	return errors.Join(errs...)
}

// Validate checks that the configuration is valid and returns an error if not.
// Every invalid field is reported at once so the operator sees all of them.
func (c *Config) Validate() error {
	return errors.Join(
		c.Server.Validate(),
		c.Storage.Validate(),
		c.Auth.Validate(),
	)
}

// Load reads and parses a YAML config file at the given path.
// It applies defaults first, then overlays the file contents.
func Load(path string) (*Config, error) {
	c := &Config{}
	c.Default()

	if path == "" {
		return c, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config: read file %q: %w", path, err)
	}

	if err := yaml.Unmarshal(data, c); err != nil {
		return nil, fmt.Errorf("config: parse yaml %q: %w", path, err)
	}

	// Re-apply defaults for any fields left zero by the YAML.
	c.Default()

	return c, nil
}

// ApplyEnv overrides config fields from well-known environment variables.
func (c *Config) ApplyEnv() {
	if v := os.Getenv("CLICKHOUSE_DSN"); v != "" {
		c.Storage.ClickHouseDSN = v
	}
	if v := os.Getenv("POSTGRES_DSN"); v != "" {
		c.Storage.PostgresDSN = v
	}
	if v := os.Getenv("JWT_SECRET"); v != "" {
		c.Auth.JWTSecret = v
	}
	if v := os.Getenv("AUTH_MODE"); v != "" {
		c.Auth.Mode = v
	}
	if v := os.Getenv("AUTH_RATE_LIMIT_PER_MINUTE"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.Auth.RateLimitPerMinute = n
		}
	}
	if v := os.Getenv("AUTH_VERIFY_RATE_LIMIT_PER_MINUTE"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.Auth.VerifyRateLimitPerMinute = n
		}
	}
	if v := os.Getenv("AUTH_TRUSTED_PROXIES"); v != "" {
		var proxies []string
		for _, p := range strings.Split(v, ",") {
			if p = strings.TrimSpace(p); p != "" {
				proxies = append(proxies, p)
			}
		}
		c.Auth.TrustedProxies = proxies
	}
	if v := os.Getenv("LISTEN_ADDR"); v != "" {
		c.Server.Addr = v
	}
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		c.Telemetry.LogLevel = v
	}
	if v := os.Getenv("LOG_FORMAT"); v != "" {
		c.Telemetry.LogFormat = v
	}
}

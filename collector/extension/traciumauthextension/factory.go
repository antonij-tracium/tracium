// Package traciumauthextension is an OpenTelemetry Collector authenticator
// extension that gates OTLP ingest on a per-workspace Tracium API key.
//
// It plugs into the receiver's standard `auth: { authenticator: traciumauth }`
// seam. On each request it pulls the ingest key from a header and verifies it
// against the Tracium API's verify endpoint, caching the result for a short TTL.
// A valid key lets the request through, and the workspace it grants is attached
// to the context so the processor can stamp it onto every span; anything
// missing, malformed, unknown, or revoked is rejected before the spans reach the
// pipeline.
//
// The extension deliberately holds no keys and touches no database: the API owns
// the key store, so the collector remains a generic OTel distribution with all
// domain state on one side of the seam.
package traciumauthextension

import (
	"context"
	"time"

	"go.opentelemetry.io/collector/component"
	"go.opentelemetry.io/collector/extension"

	"github.com/tracium/collector/extension/traciumauthextension/internal/metadata"
)

// NewFactory returns the factory for the Tracium ingest-auth extension.
func NewFactory() extension.Factory {
	return extension.NewFactory(
		metadata.Type,
		createDefaultConfig,
		createExtension,
		metadata.ExtensionStability,
	)
}

func createDefaultConfig() component.Config {
	return &Config{
		Header:             "authorization",
		Scheme:             "Bearer",
		CacheTTL:           60 * time.Second,
		CacheMaxEntries:    defaultCacheMaxEntries,
		Timeout:            5 * time.Second,
		SenderVerifyLimit:  20,
		SenderVerifyWindow: time.Minute,
	}
}

func createExtension(_ context.Context, set extension.Settings, cfg component.Config) (extension.Extension, error) {
	return newAuth(cfg.(*Config), set.Logger), nil
}

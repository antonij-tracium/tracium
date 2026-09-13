// Package ingest holds the sanity bounds every ingest path enforces on
// client-controlled fields before they can reach storage or pricing.
//
// Both the span enrichment chain and the metrics (token-usage) path arrive over
// the same OTLP receivers, and an ingest key authenticates the sender without
// making its self-reported fields trustworthy, so both must apply identical
// limits — a bound enforced for spans but not for metrics is not a bound. Keeping the
// constants and helpers here gives one source of truth so the two paths cannot
// drift apart. The bounds are set far above anything a working client produces:
// crossing one means the client is broken (or hostile), not that the call was
// unusual.
package ingest

import (
	"strings"
	"unicode"
)

const (
	// MaxTokensPerCall caps any single token count on one call. The largest
	// context window advertised by any model today is ~10M tokens, so this leaves
	// an order of magnitude of headroom. Without a ceiling a data point claiming
	// 1e15 tokens prices at billions of dollars, and since every aggregate is a
	// sum(cost_usd), one such row destroys the cost figures for everyone.
	MaxTokensPerCall = 100_000_000

	// MaxModelNameBytes caps the model name. metrics_daily types its model column
	// as LowCardinality(String) and feeds it from the (client controlled)
	// normalized model name; unbounded values degrade the one rollup that keeps
	// 90d/1y windows affordable. An id longer than this is not a model id.
	MaxModelNameBytes = 256

	// MaxUserIDBytes caps the user label, likewise a LowCardinality grouping key
	// in metrics_daily.
	MaxUserIDBytes = 128
)

// TokensInRange reports whether a token count is within the accepted bounds: not
// negative and not above MaxTokensPerCall.
func TokensInRange(n int64) bool {
	return n >= 0 && n <= MaxTokensPerCall
}

// SanitizeIdentifier makes a client-supplied identifier safe to store and to
// group by: control characters (null bytes, newlines) are dropped and the result
// is capped at maxBytes on a valid UTF-8 boundary.
func SanitizeIdentifier(s string, maxBytes int) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.TrimSpace(s))
	if len(s) <= maxBytes {
		return s
	}
	return strings.ToValidUTF8(s[:maxBytes], "")
}

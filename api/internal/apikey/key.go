// Package apikey issues and verifies per-workspace ingestion credentials.
//
// A key is a single opaque token of the form:
//
//	trc_<hex-encoded random bytes>
//
// Only the token's SHA-256 hash is persisted; the plaintext is returned to the
// caller once at creation and cannot be recovered afterwards. Verification
// hashes the presented token and looks the row up by hash, so the lookup is
// exact and constant work regardless of how many keys exist — there is no
// per-candidate secret comparison to time-attack.
package apikey

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

// tokenPrefix marks Tracium ingest keys so they are recognisable in logs and
// secret scanners, and so a token pasted into the wrong field is obvious.
const tokenPrefix = "trc_"

// secretBytes is the entropy behind each token. 32 bytes (256 bits) is well past
// any brute-force concern and matches what GitHub/Stripe-style tokens carry.
const secretBytes = 32

// displayPrefixLen is how much of the token is retained, in clear, as the
// human-facing identifier (e.g. "trc_9f3a1b2c"). Long enough to disambiguate a
// handful of keys, short enough to reveal nothing useful to an attacker.
const displayPrefixLen = len(tokenPrefix) + 8

// generated is a freshly minted key: the plaintext token to hand back to the
// caller once, plus the derived values that are safe to store.
type generated struct {
	Token  string // full plaintext — returned to the caller exactly once
	Prefix string // non-secret display slice, persisted
	Hash   string // SHA-256 of Token, persisted; the lookup key
}

// generate mints a new token from the crypto RNG. An RNG failure is surfaced
// rather than papered over — a low-entropy key must never be issued.
func generate() (generated, error) {
	buf := make([]byte, secretBytes)
	if _, err := rand.Read(buf); err != nil {
		return generated{}, fmt.Errorf("apikey: read random: %w", err)
	}
	token := tokenPrefix + hex.EncodeToString(buf)
	return generated{
		Token:  token,
		Prefix: token[:displayPrefixLen],
		Hash:   hashToken(token),
	}, nil
}

// hashToken derives the stored lookup hash for a token. A plain SHA-256 (not a
// slow password hash) is deliberate: the token is already high-entropy, so
// stretching buys nothing, and verification needs a deterministic value it can
// index and match on directly.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// looksLikeToken reports whether a presented string is even shaped like one of
// our tokens. It lets verification reject obviously-wrong input before touching
// the database, without leaking timing about real keys.
func looksLikeToken(token string) bool {
	return strings.HasPrefix(token, tokenPrefix) && len(token) == len(tokenPrefix)+hex.EncodedLen(secretBytes)
}

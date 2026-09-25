// Package token mints prefixed, high-entropy secrets and their storable hashes.
package token

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

const secretBytes = 32

// New returns prefix followed by 32 random bytes, hex-encoded.
func New(prefix string) (string, error) {
	buf := make([]byte, secretBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("token: read random: %w", err)
	}
	return prefix + hex.EncodeToString(buf), nil
}

// Hash returns the hex SHA-256 of a token. The token is already high-entropy,
// so no slow hash is needed.
func Hash(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

// Valid reports whether t has the shape of a token minted with prefix.
func Valid(prefix, t string) bool {
	return strings.HasPrefix(t, prefix) && len(t) == len(prefix)+hex.EncodedLen(secretBytes)
}

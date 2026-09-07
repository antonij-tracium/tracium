package user

import "context"

// Resolver maps an API key to a user ID.
// Implementations must be safe for concurrent use.
type Resolver interface {
	// Resolve returns the user ID for the given API key.
	// Returns an error if the user cannot be determined.
	Resolve(ctx context.Context, apiKey string) (string, error)
}

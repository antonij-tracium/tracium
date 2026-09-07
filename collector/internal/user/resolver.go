package tenant

import "context"

// Resolver maps an API key to a tenant ID.
// Implementations must be safe for concurrent use.
type Resolver interface {
	// Resolve returns the tenant ID for the given API key.
	// Returns an error if the tenant cannot be determined.
	Resolve(ctx context.Context, apiKey string) (string, error)
}

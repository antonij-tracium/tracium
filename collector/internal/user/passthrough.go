package tenant

import "context"

// Passthrough is the OSS tenant resolver: it treats the incoming value (an API
// key or a tenant attribute carried on the span) as the tenant ID itself, with
// no external lookup. The Enterprise edition swaps in a resolver backed by a
// real tenant store behind the same Resolver interface.
type Passthrough struct{}

// Resolve returns apiKey unchanged.
func (Passthrough) Resolve(_ context.Context, apiKey string) (string, error) {
	return apiKey, nil
}

package tenant

import (
	"context"
	"sync"
)

// CachedResolver wraps any Resolver with a sync.Map-based in-memory cache.
// Cache entries never expire — suitable when the tenant set is small and
// stable. For a TTL-aware cache see CachedResolverWithTTL.
type CachedResolver struct {
	inner Resolver
	cache sync.Map // map[string]string — apiKey → tenantID
}

// NewCachedResolver wraps inner with an in-memory cache.
func NewCachedResolver(inner Resolver) *CachedResolver {
	return &CachedResolver{inner: inner}
}

// Resolve returns the tenant ID for apiKey. The result is cached after the
// first successful lookup.
func (c *CachedResolver) Resolve(ctx context.Context, apiKey string) (string, error) {
	if v, ok := c.cache.Load(apiKey); ok {
		return v.(string), nil
	}

	tenantID, err := c.inner.Resolve(ctx, apiKey)
	if err != nil {
		return "", err
	}

	// Store only on success so a transient failure doesn't cache "".
	c.cache.Store(apiKey, tenantID)
	return tenantID, nil
}

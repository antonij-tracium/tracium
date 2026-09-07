package user

import (
	"container/list"
	"context"
	"sync"
)

// DefaultCacheSize bounds CachedResolver when no explicit size is given. It is a
// ceiling on distinct API keys held in memory, not a tuning target: the cache
// exists to spare a costly external resolver repeated lookups, and the number of
// genuinely active keys is far below this. The point is that the bound exists.
const DefaultCacheSize = 10_000

// CachedResolver wraps a Resolver with a bounded, LRU in-memory cache.
//
// The bound matters for security, not just memory hygiene: the cache key is a
// sender-supplied API key / user label, so an unbounded cache lets any client
// that can reach the collector grow resident memory without limit by sending a
// stream of distinct labels (memory exhaustion). Capping the entry count keeps
// footprint bounded regardless of how many distinct labels arrive; the
// least-recently-used entry is evicted once the cap is reached.
//
// Do not wrap a no-op resolver (e.g. Passthrough) in this — caching an operation
// that just returns its input adds a per-label entry for no benefit, which is
// exactly the growth this cache is meant to bound. Use the inner resolver
// directly in that case.
type CachedResolver struct {
	inner    Resolver
	capacity int

	mu    sync.Mutex
	ll    *list.List               // front = most recently used
	items map[string]*list.Element // apiKey → element holding *entry
}

type entry struct {
	key    string
	userID string
}

// NewCachedResolver wraps inner with a bounded LRU cache. A capacity <= 0 uses
// DefaultCacheSize.
func NewCachedResolver(inner Resolver, capacity int) *CachedResolver {
	if capacity <= 0 {
		capacity = DefaultCacheSize
	}
	return &CachedResolver{
		inner:    inner,
		capacity: capacity,
		ll:       list.New(),
		items:    make(map[string]*list.Element, capacity),
	}
}

// Resolve returns the user ID for apiKey, caching the first successful lookup and
// evicting the least-recently-used entry when the cache is full.
func (c *CachedResolver) Resolve(ctx context.Context, apiKey string) (string, error) {
	if v, ok := c.get(apiKey); ok {
		return v, nil
	}

	userID, err := c.inner.Resolve(ctx, apiKey)
	if err != nil {
		// Store only on success so a transient failure doesn't cache "".
		return "", err
	}

	c.add(apiKey, userID)
	return userID, nil
}

func (c *CachedResolver) get(apiKey string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[apiKey]; ok {
		c.ll.MoveToFront(el)
		return el.Value.(*entry).userID, true
	}
	return "", false
}

func (c *CachedResolver) add(apiKey, userID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if el, ok := c.items[apiKey]; ok {
		el.Value.(*entry).userID = userID
		c.ll.MoveToFront(el)
		return
	}

	c.items[apiKey] = c.ll.PushFront(&entry{key: apiKey, userID: userID})

	for c.ll.Len() > c.capacity {
		oldest := c.ll.Back()
		if oldest == nil {
			break
		}
		c.ll.Remove(oldest)
		delete(c.items, oldest.Value.(*entry).key)
	}
}

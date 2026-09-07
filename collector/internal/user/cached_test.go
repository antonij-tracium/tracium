package user

import (
	"context"
	"strconv"
	"testing"
)

// countingResolver records how many times the inner resolver was invoked.
type countingResolver struct{ calls int }

func (c *countingResolver) Resolve(_ context.Context, apiKey string) (string, error) {
	c.calls++
	return apiKey, nil
}

// A flood of distinct sender-supplied labels must not grow the cache without
// bound: the entry count is capped at the configured capacity.
func TestCachedResolverEvictsBeyondCapacity(t *testing.T) {
	inner := &countingResolver{}
	c := NewCachedResolver(inner, 100)

	for i := 0; i < 10_000; i++ {
		if _, err := c.Resolve(context.Background(), "user-"+strconv.Itoa(i)); err != nil {
			t.Fatalf("resolve: %v", err)
		}
	}

	c.mu.Lock()
	entries := c.ll.Len()
	mapLen := len(c.items)
	c.mu.Unlock()

	if entries > 100 || mapLen > 100 {
		t.Fatalf("cache grew unbounded: list=%d map=%d, want <= 100", entries, mapLen)
	}
	if entries != mapLen {
		t.Fatalf("list and map out of sync: list=%d map=%d", entries, mapLen)
	}
}

// A cached key is served without re-invoking the inner resolver, and refreshing
// it keeps it from being evicted.
func TestCachedResolverCachesAndKeepsRecent(t *testing.T) {
	inner := &countingResolver{}
	c := NewCachedResolver(inner, 2)
	ctx := context.Background()

	// "hot" stays referenced; two more keys force eviction of the LRU entry.
	if _, err := c.Resolve(ctx, "hot"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Resolve(ctx, "cold"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Resolve(ctx, "hot"); err != nil { // refresh hot → cold is LRU
		t.Fatal(err)
	}
	if _, err := c.Resolve(ctx, "new"); err != nil { // evicts cold
		t.Fatal(err)
	}

	callsBefore := inner.calls
	if _, err := c.Resolve(ctx, "hot"); err != nil { // still cached, no new call
		t.Fatal(err)
	}
	if inner.calls != callsBefore {
		t.Fatalf("hot was not served from cache: calls went %d → %d", callsBefore, inner.calls)
	}
}

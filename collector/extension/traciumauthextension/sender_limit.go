package traciumauthextension

import (
	"sync"
	"time"
)

// senderLimiter is a fixed-window, in-memory limiter keyed by sender (the ingest
// request's peer address). It bounds how many verification calls one sender can
// force the collector to make against the API in a window.
//
// Only cache misses are counted, so a well-behaved sender presenting one valid
// key is charged once and then served from cache indefinitely — high-volume
// legitimate ingest is never throttled here. An abusive sender streaming distinct
// (typically invalid) keys misses the cache every time, and this cuts it off
// before it can spend the collector's shared verify budget and starve everyone
// else behind the same collector.
type senderLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	// maxEntries caps how many distinct senders are tracked, so a sender that
	// rotates its source address cannot grow the map without bound. Expired
	// windows are swept before the cap is enforced.
	maxEntries int
	seen       map[string]*senderWindow
}

type senderWindow struct {
	count int
	start time.Time
}

// senderLimiterMaxEntries bounds the number of distinct senders tracked at once.
// A sender is one peer address; the true count of active senders behind a
// collector is well below this. The point is that a bound exists — the map is
// keyed by a sender-supplied source, so it must not grow without limit.
const senderLimiterMaxEntries = 100_000

// newSenderLimiter builds a limiter allowing at most limit misses per window per
// sender. A non-positive limit yields nil, meaning "no per-sender limit".
func newSenderLimiter(limit int, window time.Duration) *senderLimiter {
	if limit <= 0 || window <= 0 {
		return nil
	}
	return &senderLimiter{
		limit:      limit,
		window:     window,
		maxEntries: senderLimiterMaxEntries,
		seen:       make(map[string]*senderWindow),
	}
}

// allow reports whether a verification attempt from sender is within the limit,
// consuming one unit of its allowance when it is. A nil limiter always allows.
func (s *senderLimiter) allow(sender string) bool {
	if s == nil {
		return true
	}
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()

	w, ok := s.seen[sender]
	if !ok || now.Sub(w.start) >= s.window {
		if !ok && len(s.seen) >= s.maxEntries {
			s.sweep(now)
			if len(s.seen) >= s.maxEntries {
				// The sweep freed nothing: every tracked window is still live, which
				// only happens when a flood of distinct source addresses fills the
				// table within one window. Refuse the new sender rather than insert
				// past the cap — maxEntries is a hard memory ceiling, and admitting
				// here is exactly the unbounded growth the cap exists to prevent.
				return false
			}
		}
		s.seen[sender] = &senderWindow{count: 1, start: now}
		return true
	}
	if w.count >= s.limit {
		return false
	}
	w.count++
	return true
}

// sweep drops entries whose window has elapsed. The caller must hold s.mu. It is
// invoked lazily when the map hits its cap, so tracking costs stay bounded by the
// set of senders active within one window rather than every sender ever seen.
func (s *senderLimiter) sweep(now time.Time) {
	for k, w := range s.seen {
		if now.Sub(w.start) >= s.window {
			delete(s.seen, k)
		}
	}
}

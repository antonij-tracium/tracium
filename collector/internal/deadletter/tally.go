package deadletter

import (
	"context"
	"errors"
	"sync"
	"time"
)

// Rejection is the key rejected spans are counted by.
type Rejection struct {
	WorkspaceID string
	Code        string
}

// TallyWriter persists rejection counts.
type TallyWriter interface {
	WriteRejected(ctx context.Context, tally map[Rejection]uint64) error
	Close() error
}

// TallyStore counts rejected spans per workspace and code, flushing the counts
// every interval, and forwards each record to the next store.
type TallyStore struct {
	next   Store
	writer TallyWriter
	logger Logger

	mu    sync.Mutex
	tally map[Rejection]uint64

	stop chan struct{}
	done chan struct{}
}

// NewTallyStore starts a TallyStore that flushes to w every interval.
func NewTallyStore(next Store, w TallyWriter, logger Logger, interval time.Duration) *TallyStore {
	s := &TallyStore{
		next:   next,
		writer: w,
		logger: logger,
		tally:  map[Rejection]uint64{},
		stop:   make(chan struct{}),
		done:   make(chan struct{}),
	}
	go s.run(interval)
	return s
}

// Put implements Store.
func (s *TallyStore) Put(ctx context.Context, rec Record) error {
	// Keyless spans have no workspace and are not charged to any.
	if rec.Span != nil && rec.Span.WorkspaceID != "" {
		s.mu.Lock()
		s.tally[Rejection{WorkspaceID: rec.Span.WorkspaceID, Code: rec.Code}]++
		s.mu.Unlock()
	}
	return s.next.Put(ctx, rec)
}

// Close implements Store, flushing pending counts first.
func (s *TallyStore) Close() error {
	close(s.stop)
	<-s.done
	return errors.Join(s.writer.Close(), s.next.Close())
}

func (s *TallyStore) run(interval time.Duration) {
	defer close(s.done)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.flush()
		case <-s.stop:
			s.flush()
			return
		}
	}
}

func (s *TallyStore) flush() {
	s.mu.Lock()
	tally := s.tally
	if len(tally) == 0 {
		s.mu.Unlock()
		return
	}
	s.tally = map[Rejection]uint64{}
	s.mu.Unlock()

	if err := s.writer.WriteRejected(context.Background(), tally); err != nil {
		s.logger.Warn("rejected-span tally not written", "rejections", len(tally), "error", err)
	}
}

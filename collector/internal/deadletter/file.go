package deadletter

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/tracium/collector/pkg/spanmodel"
)

// FileStore appends rejected spans to a file as NDJSON (one JSON object per
// line). This is what makes a drop recoverable: once the upstream defect is
// fixed the file can be inspected with jq or replayed into the pipeline.
//
// Writes are serialised by a mutex, since the collector calls Put from several
// goroutines. Rotation is deliberately left to the operator (logrotate or a
// sidecar) — a second, worse implementation of it does not belong here.
type FileStore struct {
	mu  sync.Mutex
	f   *os.File
	enc *json.Encoder
}

// NewFileStore opens path for appending, creating it if it does not exist.
// It is called at startup so an unwritable path fails the process immediately
// rather than at the first dropped span.
func NewFileStore(path string) (*FileStore, error) {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open dead-letter file %q: %w", path, err)
	}
	return &FileStore{f: f, enc: json.NewEncoder(f)}, nil
}

// entry is the on-disk shape: the record plus when it was rejected.
type entry struct {
	DroppedAt time.Time       `json:"dropped_at"`
	Code      string          `json:"code"`
	Reason    string          `json:"reason"`
	Span      *spanmodel.Span `json:"span"`
}

// Put implements Store.
func (s *FileStore) Put(_ context.Context, rec Record) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	// json.Encoder terminates every value with a newline, which is exactly the
	// NDJSON framing.
	return s.enc.Encode(entry{
		DroppedAt: time.Now().UTC(),
		Code:      rec.Code,
		Reason:    rec.Reason,
		Span:      rec.Span,
	})
}

// Close implements Store.
func (s *FileStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.f.Close()
}

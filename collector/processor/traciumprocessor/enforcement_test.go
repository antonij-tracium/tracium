package traciumprocessor

import (
	"context"
	"testing"
	"time"

	"github.com/tracium/collector/enrich"
	"github.com/tracium/collector/internal/deadletter"
	customerrors "github.com/tracium/collector/internal/errors"
	"github.com/tracium/collector/internal/pricing"
	"github.com/tracium/collector/internal/user"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.uber.org/zap"
)

// captureStore records every dead-lettered span so a test can assert what was
// rejected and why.
type captureStore struct{ records []deadletter.Record }

func (c *captureStore) Put(_ context.Context, rec deadletter.Record) error {
	c.records = append(c.records, rec)
	return nil
}
func (c *captureStore) Close() error { return nil }

// newTestProcessor builds a processor with the real OSS enrichment chain and a
// capturing dead-letter store.
func newTestProcessor() (*traciumProcessor, *captureStore) {
	dlq := &captureStore{}
	chain := enrich.DefaultChain(pricing.NewStaticResolver(pricing.DefaultPrices()), user.Passthrough{}, nil)
	p := &traciumProcessor{
		logger:         zap.NewNop(),
		chain:          chain,
		captureContent: true,
		deadLetter:     dlq,
	}
	return p, dlq
}

// tracesWithWorkspace builds a one-span batch. workspace is set as the
// tracium.workspace.id attribute when non-empty; the span is otherwise valid so
// it survives enrichment.
func tracesWithWorkspace(workspace string) ptrace.Traces {
	td := ptrace.NewTraces()
	span := td.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	span.SetTraceID(pcommon.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16})
	span.SetSpanID(pcommon.SpanID{1, 2, 3, 4, 5, 6, 7, 8})
	now := time.Now()
	span.SetStartTimestamp(pcommon.NewTimestampFromTime(now))
	span.SetEndTimestamp(pcommon.NewTimestampFromTime(now.Add(time.Second)))
	span.SetName("chat")
	if workspace != "" {
		span.Attributes().PutStr(attrWorkspaceID, workspace)
	}
	return td
}

func spanCount(td ptrace.Traces) int {
	n := 0
	rss := td.ResourceSpans()
	for i := 0; i < rss.Len(); i++ {
		sss := rss.At(i).ScopeSpans()
		for j := 0; j < sss.Len(); j++ {
			n += sss.At(j).Spans().Len()
		}
	}
	return n
}

func spanWorkspace(td ptrace.Traces) string {
	v, _ := td.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0).Attributes().Get(attrWorkspaceID)
	return v.AsString()
}

// An authenticated request has the key's workspace stamped onto its spans, which
// then survive the pipeline.
func TestProcessTracesStampsKeyWorkspace(t *testing.T) {
	p, dlq := newTestProcessor()
	ctx := ctxWithAuth(fakeAuth{workspace: "ws-1"})

	out, err := p.processTraces(ctx, tracesWithWorkspace(""))
	if err != nil {
		t.Fatalf("processTraces: %v", err)
	}
	if got := spanCount(out); got != 1 {
		t.Fatalf("span was dropped: span count = %d", got)
	}
	if len(dlq.records) != 0 {
		t.Fatalf("span was dead-lettered: %+v", dlq.records)
	}
	if got := spanWorkspace(out); got != "ws-1" {
		t.Fatalf("workspace = %q, want stamped ws-1", got)
	}
}

// The key's workspace is authoritative: a sender-supplied workspace is
// overridden, not trusted, so a client cannot write into another workspace.
func TestProcessTracesOverridesClientWorkspace(t *testing.T) {
	p, dlq := newTestProcessor()
	ctx := ctxWithAuth(fakeAuth{workspace: "ws-1"})

	out, err := p.processTraces(ctx, tracesWithWorkspace("ws-CLIENT-CLAIMED"))
	if err != nil {
		t.Fatalf("processTraces: %v", err)
	}
	if got := spanCount(out); got != 1 {
		t.Fatalf("span was dropped: span count = %d", got)
	}
	if len(dlq.records) != 0 {
		t.Fatalf("span was dead-lettered: %+v", dlq.records)
	}
	if got := spanWorkspace(out); got != "ws-1" {
		t.Fatalf("workspace = %q, want key's ws-1 (client value overridden)", got)
	}
}

// With no verified ingest key on the context, the span is rejected: ingest is
// key-only, so a request that reached the processor unauthenticated (the
// receiver authenticator absent) is dropped and dead-lettered, never stored —
// and a sender-supplied workspace buys nothing.
func TestProcessTracesNoAuthDropsSpan(t *testing.T) {
	p, dlq := newTestProcessor()

	out, err := p.processTraces(context.Background(), tracesWithWorkspace("client-ws"))
	if err != nil {
		t.Fatalf("processTraces: %v", err)
	}
	if got := spanCount(out); got != 0 {
		t.Fatalf("keyless span survived: span count = %d, want 0", got)
	}
	if len(dlq.records) != 1 {
		t.Fatalf("keyless span not dead-lettered: %+v", dlq.records)
	}
	if got := dlq.records[0].Code; got != string(customerrors.ErrUnauthenticated) {
		t.Fatalf("drop code = %q, want %q", got, customerrors.ErrUnauthenticated)
	}
}

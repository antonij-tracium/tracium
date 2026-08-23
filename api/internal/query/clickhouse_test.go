package query

import (
	"strings"
	"testing"
	"time"
)

// Every read of tracium.spans that reconstructs a trace must be pinned to the
// span source. Metric rows carry an empty trace_id, so an unpinned GROUP BY
// trace_id collapses them all into one phantom trace.
func TestTraceFilterSQLPinsSpanSource(t *testing.T) {
	f := TraceFilter{StartAfter: time.UnixMilli(100), StartBefore: time.UnixMilli(200)}
	clause, args := traceFilterSQL(f)

	if !strings.Contains(clause, "source = ?") {
		t.Errorf("clause missing source predicate: %q", clause)
	}
	// The source arg binds after the two time bounds and before any tenant.
	if len(args) != 3 || args[2] != sourceSpan {
		t.Errorf("args = %v, want [100 200 %q]", args, sourceSpan)
	}

	// A tenant filter still binds after the source, keeping arg order aligned.
	f.TenantID = "acme"
	_, args = traceFilterSQL(f)
	if len(args) != 4 || args[2] != sourceSpan || args[3] != "acme" {
		t.Errorf("tenant args = %v", args)
	}
}

// GetSpans reads by trace_id; it pins the source for the same reason.
func TestSpanSelectPinsSpanSource(t *testing.T) {
	if !strings.Contains(spanSelect, "source = ?") {
		t.Errorf("spanSelect missing source predicate: %q", spanSelect)
	}
}

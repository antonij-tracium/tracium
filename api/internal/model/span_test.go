package model

import (
	"errors"
	"testing"

	"github.com/tracium/api/internal/version"
)

func TestAssignSubtreeTotals(t *testing.T) {
	// Tree (cost / input tokens / output tokens):
	//   root (0.001 / 10 / 5)
	//   ├── sub-workflow (0 / 0 / 0)
	//   │   ├── llm (0.004 / 100 / 40)
	//   │   └── tool (0 / 0 / 0)
	//   └── llm (0.002 / 60 / 20)
	spans := []Span{
		{SpanID: "root", ParentSpanID: "", CostUSD: 0.001, InputTokens: 10, OutputTokens: 5},
		{SpanID: "sub", ParentSpanID: "root", CostUSD: 0},
		{SpanID: "sub-llm", ParentSpanID: "sub", CostUSD: 0.004, InputTokens: 100, OutputTokens: 40},
		{SpanID: "sub-tool", ParentSpanID: "sub", CostUSD: 0},
		{SpanID: "root-llm", ParentSpanID: "root", CostUSD: 0.002, InputTokens: 60, OutputTokens: 20},
	}

	AssignSubtreeTotals(spans)

	type want struct {
		cost float64
		in   int64
		out  int64
	}
	wants := map[string]want{
		"root":     {0.007, 170, 65}, // own + every descendant
		"sub":      {0.004, 100, 40},
		"sub-llm":  {0.004, 100, 40},
		"sub-tool": {0, 0, 0},
		"root-llm": {0.002, 60, 20},
	}
	for _, s := range spans {
		w := wants[s.SpanID]
		if s.SubtreeCostUSD != w.cost {
			t.Errorf("span %s: subtree cost = %v, want %v", s.SpanID, s.SubtreeCostUSD, w.cost)
		}
		if s.SubtreeInputTokens != w.in {
			t.Errorf("span %s: subtree input tokens = %v, want %v", s.SpanID, s.SubtreeInputTokens, w.in)
		}
		if s.SubtreeOutputTokens != w.out {
			t.Errorf("span %s: subtree output tokens = %v, want %v", s.SpanID, s.SubtreeOutputTokens, w.out)
		}
	}
}

func TestAssignSubtreeTotals_LeafEqualsOwn(t *testing.T) {
	spans := []Span{{SpanID: "only", CostUSD: 0.5, InputTokens: 12, OutputTokens: 8}}
	AssignSubtreeTotals(spans)
	if spans[0].SubtreeCostUSD != 0.5 {
		t.Errorf("leaf subtree cost = %v, want 0.5", spans[0].SubtreeCostUSD)
	}
	if spans[0].SubtreeInputTokens != 12 || spans[0].SubtreeOutputTokens != 8 {
		t.Errorf("leaf subtree tokens = %v/%v, want 12/8", spans[0].SubtreeInputTokens, spans[0].SubtreeOutputTokens)
	}
}

func TestAssignSubtreeTotals_CyclicParentLinkTerminates(t *testing.T) {
	// Malformed: a <-> b reference each other. Must not loop forever.
	spans := []Span{
		{SpanID: "a", ParentSpanID: "b", CostUSD: 1, InputTokens: 1},
		{SpanID: "b", ParentSpanID: "a", CostUSD: 2, InputTokens: 2},
	}
	AssignSubtreeTotals(spans) // completing without hanging is the assertion
}

func TestAssignSubtreeTotals_OrphanParentTreatedAsRoot(t *testing.T) {
	// "child" points at a parent absent from the set; it still gets its own totals.
	spans := []Span{{SpanID: "child", ParentSpanID: "missing", CostUSD: 0.3, InputTokens: 7, OutputTokens: 3}}
	AssignSubtreeTotals(spans)
	if spans[0].SubtreeCostUSD != 0.3 {
		t.Errorf("orphan subtree cost = %v, want 0.3", spans[0].SubtreeCostUSD)
	}
	if spans[0].SubtreeInputTokens != 7 || spans[0].SubtreeOutputTokens != 3 {
		t.Errorf("orphan subtree tokens = %v/%v, want 7/3", spans[0].SubtreeInputTokens, spans[0].SubtreeOutputTokens)
	}
}

func TestCheckSchemaCompatibility(t *testing.T) {
	tests := []struct {
		name      string
		versions  []int
		wantError bool
	}{
		{"current schema is served", []int{1, 1}, false},
		{"older rows are served, never fail", []int{0}, false},
		{"a newer row is refused", []int{1, 99}, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			spans := make([]Span, len(tc.versions))
			for i, v := range tc.versions {
				spans[i] = Span{SpanID: "s", SchemaVersion: v}
			}

			err := CheckSchemaCompatibility(spans)
			if tc.wantError {
				var compat *version.CompatibilityError
				if !errors.As(err, &compat) {
					t.Fatalf("got %v, want a *version.CompatibilityError", err)
				}
				if compat.ServerVersion != version.CurrentSchema {
					t.Errorf("ServerVersion = %d, want %d", compat.ServerVersion, version.CurrentSchema)
				}
			} else if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

package rolluprepair

import (
	"strings"
	"testing"
)

func TestDays(t *testing.T) {
	got, err := Days("2026-07-14", "2026-07-16")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []string{"2026-07-14", "2026-07-15", "2026-07-16"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("Days = %v, want %v", got, want)
	}

	// A single day is [from, from].
	if d, _ := Days("2026-07-14", "2026-07-14"); len(d) != 1 || d[0] != "2026-07-14" {
		t.Errorf("single day = %v", d)
	}

	// Malformed and inverted ranges error.
	if _, err := Days("2026/07/14", "2026-07-16"); err == nil {
		t.Error("expected error for malformed --from")
	}
	if _, err := Days("2026-07-16", "2026-07-14"); err == nil {
		t.Error("expected error for inverted range")
	}
}

func TestClassify(t *testing.T) {
	const day = "2026-07-14"
	closed := DayStats{RawSpans: 5, DistinctDays: 1, MinDay: day, MaxDay: day, AgeSeconds: 10_000}
	opts := Options{QuiesceSeconds: 300}

	tests := []struct {
		name  string
		stats DayStats
		opts  Options
		want  Action
	}{
		{"closed day rebuilds", closed, opts, Rebuild},
		{"empty day skipped by default", DayStats{RawSpans: 0}, opts, SkipEmpty},
		{"empty day rebuilt with allow-empty", DayStats{RawSpans: 0}, Options{QuiesceSeconds: 300, AllowEmpty: true}, Rebuild},
		{"open day refused", DayStats{RawSpans: 5, DistinctDays: 1, MinDay: day, MaxDay: day, AgeSeconds: 10}, opts, RefuseOpen},
		{"open day forced through", DayStats{RawSpans: 5, DistinctDays: 1, MinDay: day, MaxDay: day, AgeSeconds: 10}, Options{QuiesceSeconds: 300, Force: true}, Rebuild},
		{"timezone spill refused", DayStats{RawSpans: 5, DistinctDays: 2, MinDay: day, MaxDay: "2026-07-15", AgeSeconds: 10_000}, opts, RefuseTimezone},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, reason := Classify(day, tt.stats, tt.opts)
			if got != tt.want {
				t.Errorf("Classify = %v, want %v (%s)", got, tt.want, reason)
			}
			if reason == "" {
				t.Error("reason should never be empty")
			}
		})
	}
}

// The rebuild INSERT must (a) target the right table, (b) push the day bound into
// the scan so it prunes rather than aggregating the whole table, and (c) bind to
// exactly one bucket_date. A rebuild that dropped the day bound would fold the
// entire spans table into one day — both wrong and unrunnable at scale.
func TestRebuildInsertIsDayBounded(t *testing.T) {
	const day = "2026-07-14"
	for _, r := range Rollups {
		ins := r.RebuildInsert(day)
		if !strings.HasPrefix(ins, "INSERT INTO "+r.Table+"\n") {
			t.Errorf("%s: insert does not target the table:\n%s", r.Table, ins)
		}
		if !strings.Contains(ins, "start_time_ms >=") || !strings.Contains(ins, "start_time_ms <") {
			t.Errorf("%s: rebuild is not day-bounded (would scan the whole table):\n%s", r.Table, ins)
		}
		if !strings.Contains(ins, day) {
			t.Errorf("%s: rebuild does not mention the day %s", r.Table, day)
		}
		// The delete pairs with it on the same single day.
		if !strings.Contains(r.DeleteDay(day), "bucket_date = toDate('"+day+"')") {
			t.Errorf("%s: delete not scoped to one day: %s", r.Table, r.DeleteDay(day))
		}
		// The canonical (drift-check) select carries no day bound.
		if strings.Contains(r.CanonicalSelect(), "start_time_ms >=") {
			t.Errorf("%s: canonical select should be unbounded (drift check compares it to the live view):\n%s", r.Table, r.CanonicalSelect())
		}
	}
}

func TestDriftMatches(t *testing.T) {
	if !DriftMatches("SELECT  a ,\n b", "SELECT a,b") {
		t.Error("whitespace-only differences should match")
	}
	if DriftMatches("SELECT a, b", "SELECT a, c") {
		t.Error("different columns should not match")
	}
	// An empty live side never matches — a missing/unreadable view must fail the check.
	if DriftMatches("SELECT a", "") {
		t.Error("empty live side must not match")
	}
}

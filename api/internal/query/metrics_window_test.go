package query

import (
	"testing"
	"time"
)

func TestParseRange(t *testing.T) {
	now := time.Date(2026, 6, 7, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		rng        string
		wantSpan   time.Duration
		wantBucket time.Duration
	}{
		{"24h", 24 * time.Hour, time.Hour},
		{"7d", 7 * 24 * time.Hour, 24 * time.Hour},
		{"30d", 30 * 24 * time.Hour, 24 * time.Hour},
		{"90d", 90 * 24 * time.Hour, 24 * time.Hour},
		{"1y", 365 * 24 * time.Hour, 24 * time.Hour},
	}
	for _, tt := range tests {
		f, err := ParseRange(tt.rng, now)
		if err != nil {
			t.Fatalf("ParseRange(%q): unexpected error %v", tt.rng, err)
		}
		if !f.End.Equal(now) {
			t.Errorf("%s: End = %v, want %v", tt.rng, f.End, now)
		}
		if got := f.End.Sub(f.Start); got != tt.wantSpan {
			t.Errorf("%s: span = %v, want %v", tt.rng, got, tt.wantSpan)
		}
		// Previous window is equal-length and immediately precedes the current one.
		if got := f.Start.Sub(f.PrevStart); got != tt.wantSpan {
			t.Errorf("%s: prev span = %v, want %v", tt.rng, got, tt.wantSpan)
		}
		if f.Bucket != tt.wantBucket {
			t.Errorf("%s: bucket = %v, want %v", tt.rng, f.Bucket, tt.wantBucket)
		}
	}
}

// UseRollup routes long windows (>30d) to the daily rollup and keeps shorter
// ones on raw spans.
func TestUseRollup(t *testing.T) {
	now := time.Date(2026, 6, 7, 12, 0, 0, 0, time.UTC)
	for _, rng := range []string{"24h", "7d", "30d"} {
		f, _ := ParseRange(rng, now)
		if f.UseRollup() {
			t.Errorf("%s: UseRollup = true, want false", rng)
		}
	}
	for _, rng := range []string{"90d", "1y"} {
		f, _ := ParseRange(rng, now)
		if !f.UseRollup() {
			t.Errorf("%s: UseRollup = false, want true", rng)
		}
	}
}

func TestParseRangeInvalid(t *testing.T) {
	if _, err := ParseRange("5y", time.Now()); err == nil {
		t.Fatal("ParseRange(\"5y\"): expected error, got nil")
	}
}

func TestKPIDeltaType(t *testing.T) {
	tests := []struct {
		name        string
		cur, prev   float64
		higherIsBad bool
		wantDelta   float64
		wantType    string
	}{
		{"cost up is bad", 2, 1, true, 1.0, "bad"},
		{"runs up is good", 110, 100, false, 0.1, "good"},
		{"latency down is good", 2, 4, true, -0.5, "good"},
		{"flat is neutral", 5, 5, true, 0, "neutral"},
		{"no prior period is neutral, not classified", 5, 0, true, 0, "neutral"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			k := kpi(tt.cur, tt.prev, tt.higherIsBad)
			if k.Value != tt.cur {
				t.Errorf("Value = %v, want %v", k.Value, tt.cur)
			}
			if k.Delta != tt.wantDelta {
				t.Errorf("Delta = %v, want %v", k.Delta, tt.wantDelta)
			}
			if k.DeltaType != tt.wantType {
				t.Errorf("DeltaType = %q, want %q", k.DeltaType, tt.wantType)
			}
		})
	}
}

func TestWindowSourceClause(t *testing.T) {
	// Every metrics query is pinned to one ingestion source so metric-derived
	// aggregate rows never mix with per-call spans.
	clause, args := window("", 100, 200, sourceSpan)
	if clause != "start_time_ms >= ? AND start_time_ms < ? AND source = ?" {
		t.Errorf("clause = %q", clause)
	}
	if len(args) != 3 || args[2] != sourceSpan {
		t.Errorf("args = %v, want [...,%q]", args, sourceSpan)
	}

	// A tenant adds a fourth bound after the source.
	clause, args = window("acme", 100, 200, sourceMetric)
	if clause != "start_time_ms >= ? AND start_time_ms < ? AND source = ? AND tenant_id = ?" {
		t.Errorf("tenant clause = %q", clause)
	}
	if len(args) != 4 || args[2] != sourceMetric || args[3] != "acme" {
		t.Errorf("args = %v", args)
	}
}

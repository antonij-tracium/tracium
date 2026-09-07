package rolluprepair

import (
	"context"
	"fmt"
	"io"
	"strings"
)

// Conn is the minimal ClickHouse access the runner needs. main wraps a *sql.DB;
// tests can substitute a fake.
type Conn interface {
	// ScanRow runs query and scans its single result row into dest.
	ScanRow(ctx context.Context, query string, dest ...any) error
	// QueryStrings runs query and returns the first column of every row.
	QueryStrings(ctx context.Context, query string) ([]string, error)
	// Exec runs a statement that returns no rows.
	Exec(ctx context.Context, query string) error
}

// Runner executes a repair against ClickHouse. Zero DryRun writes; set it to
// print the SQL and change nothing.
type Runner struct {
	DB     Conn
	Out    io.Writer
	Opts   Options
	DryRun bool
}

func (r *Runner) logf(format string, a ...any) { fmt.Fprintf(r.Out, format+"\n", a...) }

// Preflight verifies every rollup's mirror still matches its deployed view. It
// aborts before any write if one has drifted, so the rebuild can never write
// aggregates the live trigger would not have produced.
func (r *Runner) Preflight(ctx context.Context) error {
	r.logf("▶ Checking deployed views match this tool's mirrors...")
	for _, rp := range Rollups {
		name := strings.TrimPrefix(rp.View, "tracium.")
		var live string
		if err := r.DB.ScanRow(ctx,
			fmt.Sprintf("SELECT as_select FROM system.tables WHERE database='tracium' AND name='%s'", name),
			&live); err != nil {
			return fmt.Errorf("read %s definition: %w", rp.View, err)
		}
		if strings.TrimSpace(live) == "" {
			return fmt.Errorf("%s does not exist — run the migrations first", rp.View)
		}
		mineNorm, err := r.explain(ctx, rp.CanonicalSelect())
		if err != nil {
			return fmt.Errorf("normalize mirror for %s: %w", rp.Table, err)
		}
		liveNorm, err := r.explain(ctx, live)
		if err != nil {
			return fmt.Errorf("normalize live %s: %w", rp.View, err)
		}
		if !DriftMatches(mineNorm, liveNorm) {
			return fmt.Errorf("%s aggregates differently from this tool's mirror — refusing to rebuild.\nlive view:\n%s", rp.View, live)
		}
	}
	r.logf("  views match the mirrors for %d rollup table(s).", len(Rollups))
	return nil
}

// explain runs EXPLAIN SYNTAX so the server reformats a SELECT into its canonical
// form, then joins the lines for comparison.
func (r *Runner) explain(ctx context.Context, sql string) (string, error) {
	lines, err := r.DB.QueryStrings(ctx, "EXPLAIN SYNTAX "+sql)
	if err != nil {
		return "", err
	}
	return strings.Join(lines, "\n"), nil
}

// Run repairs each day in order. It preflights once, then per day gathers the
// span stats, classifies, and either rebuilds every rollup for that day or
// stops. A refused day aborts the run (earlier days are already committed).
func (r *Runner) Run(ctx context.Context, days []string) error {
	if err := r.Preflight(ctx); err != nil {
		return err
	}
	r.logf("▶ %s %d day(s): %s .. %s", verb(r.DryRun), len(days), days[0], days[len(days)-1])
	for _, day := range days {
		if err := r.repairDay(ctx, day); err != nil {
			return err
		}
	}
	if r.DryRun {
		r.logf("✔ Dry run complete — no changes made.")
	} else {
		r.logf("✔ Rollup repair complete. Long windows (>30d) read these tables; short windows read raw spans. Both should now agree for the repaired days.")
	}
	return nil
}

func (r *Runner) repairDay(ctx context.Context, day string) error {
	var s DayStats
	if err := r.DB.ScanRow(ctx, statsSQL(day),
		&s.RawSpans, &s.DistinctDays, &s.MinDay, &s.MaxDay, &s.AgeSeconds); err != nil {
		return fmt.Errorf("gather stats for %s: %w", day, err)
	}
	action, reason := Classify(day, s, r.Opts)
	r.logf("▶ %s — %s", day, reason)

	switch action {
	case SkipEmpty:
		return nil
	case RefuseOpen, RefuseTimezone:
		return fmt.Errorf("%s: %s", day, reason)
	}

	// Rebuild: delete then re-insert each rollup for this day.
	for _, rp := range Rollups {
		del := rp.DeleteDay(day)
		ins := rp.RebuildInsert(day)
		if r.DryRun {
			r.logf("  -- %s --\n%s;\n%s;", rp.Table, del, ins)
			continue
		}
		// mutations_sync=2 waits for the delete to finish so the insert cannot
		// race the mutation clearing the same rows.
		if err := r.DB.Exec(ctx, del+" SETTINGS mutations_sync=2"); err != nil {
			return fmt.Errorf("delete %s for %s: %w", rp.Table, day, err)
		}
		if err := r.DB.Exec(ctx, ins); err != nil {
			return fmt.Errorf("rebuild %s for %s: %w", rp.Table, day, err)
		}
		r.logf("  rebuilt %s", rp.Table)
	}
	return nil
}

// statsSQL gathers one day's span stats (see DayStats). Both rollups derive their
// guards from the shared source, tracium.spans, so this reads it once per day.
func statsSQL(day string) string {
	return `SELECT
    toInt64(count()),
    toInt64(countDistinct(toDate(start_time_ms / 1000))),
    toString(min(toDate(start_time_ms / 1000))),
    toString(max(toDate(start_time_ms / 1000))),
    toInt64(dateDiff('second', max(received_at), now()))
FROM tracium.spans` + whereClause(SpanStatsWhere(day))
}

func verb(dryRun bool) string {
	if dryRun {
		return "Would rebuild"
	}
	return "Rebuilding"
}

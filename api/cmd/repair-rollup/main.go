// Command repair-rollup rebuilds the daily rollup tables (tracium.metrics_daily
// and tracium.metrics_daily_cost) for specific days from the raw spans, after a
// bad span has been deleted from tracium.spans. See internal/rolluprepair for why
// this is necessary (materialized views do not retract on DELETE) and the docs at
// deploy/docs/rollup-repair.md.
//
// Usage:
//
//	repair-rollup --from 2026-07-14 [--to 2026-07-16] [flags]
//
//	--from DATE       first bucket_date to rebuild (YYYY-MM-DD, required)
//	--to DATE         last bucket_date to rebuild, inclusive (default: --from)
//	--dry-run         print the SQL and change nothing
//	--allow-empty     rebuild days with no spans left (empties them in the rollup)
//	--force           skip the quiescence guard (only when ingestion is stopped)
//	--yes             do not prompt for confirmation
//	--quiesce-seconds refuse a day whose newest span is younger than this (default 300)
//
// Connection: CLICKHOUSE_DSN (same as the API), e.g.
// clickhouse://default:pw@host:9000/tracium.
package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"os"
	"strings"

	_ "github.com/ClickHouse/clickhouse-go/v2"
	"github.com/joho/godotenv"

	"github.com/tracium/api/internal/rolluprepair"
)

func main() {
	_ = godotenv.Load()

	var (
		from    = flag.String("from", "", "first bucket_date to rebuild (YYYY-MM-DD, required)")
		to      = flag.String("to", "", "last bucket_date to rebuild, inclusive (default: --from)")
		dryRun  = flag.Bool("dry-run", false, "print the SQL and change nothing")
		allowE  = flag.Bool("allow-empty", false, "rebuild days with no spans left (empties them)")
		force   = flag.Bool("force", false, "skip the quiescence guard (only when ingestion is stopped)")
		yes     = flag.Bool("yes", false, "do not prompt for confirmation")
		quiesce = flag.Int64("quiesce-seconds", 300, "refuse a day whose newest span is younger than this")
	)
	flag.Parse()

	if *from == "" {
		fmt.Fprintln(os.Stderr, "✘ --from is required")
		flag.Usage()
		os.Exit(2)
	}
	if *to == "" {
		*to = *from
	}
	days, err := rolluprepair.Days(*from, *to)
	if err != nil {
		fail(err)
	}

	dsn := os.Getenv("CLICKHOUSE_DSN")
	if dsn == "" {
		fail(fmt.Errorf("CLICKHOUSE_DSN is not set"))
	}
	db, err := sql.Open("clickhouse", dsn)
	if err != nil {
		fail(fmt.Errorf("open clickhouse: %w", err))
	}
	defer db.Close()
	ctx := context.Background()
	if err := db.PingContext(ctx); err != nil {
		fail(fmt.Errorf("connect to clickhouse: %w", err))
	}

	if !*dryRun && !*yes {
		fmt.Printf("Delete and rebuild rollup days %s .. %s? [y/N] ", days[0], days[len(days)-1])
		var reply string
		fmt.Scanln(&reply)
		if r := strings.ToLower(strings.TrimSpace(reply)); r != "y" && r != "yes" {
			fmt.Println("  aborted.")
			os.Exit(1)
		}
	}

	runner := &rolluprepair.Runner{
		DB:     sqlConn{db},
		Out:    os.Stdout,
		DryRun: *dryRun,
		Opts: rolluprepair.Options{
			QuiesceSeconds: *quiesce,
			AllowEmpty:     *allowE,
			Force:          *force,
		},
	}
	if err := runner.Run(ctx, days); err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintf(os.Stderr, "✘ %v\n", err)
	os.Exit(1)
}

// sqlConn adapts *sql.DB to rolluprepair.Conn.
type sqlConn struct{ db *sql.DB }

func (c sqlConn) ScanRow(ctx context.Context, query string, dest ...any) error {
	return c.db.QueryRowContext(ctx, query).Scan(dest...)
}

func (c sqlConn) QueryStrings(ctx context.Context, query string) ([]string, error) {
	rows, err := c.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (c sqlConn) Exec(ctx context.Context, query string) error {
	_, err := c.db.ExecContext(ctx, query)
	return err
}

# Repairing the daily rollup

Removing a bad span from `tracium.spans` is **not** enough to correct the
dashboard. Remediation must clean **both** tables.

## Why deleting the span is not enough

`tracium.metrics_daily` is filled by `metrics_daily_mv`, an **insert trigger**.
Materialized views do not retract on `DELETE`, so whatever a bad span
contributed to the rollup stays there after the span itself is gone.

This is easy to miss, because the two halves of the product disagree:

| Dashboard window | Reads from | After deleting the span |
|---|---|---|
| 24h / 7d / 30d | raw `tracium.spans` | recovers immediately |
| 90d / 1y | `tracium.metrics_daily` | **stays wrong forever** |

An operator deletes the offending span, watches the short windows return to
normal, and concludes the incident is over. The long windows keep serving the
poisoned figure with no visible cause.

```sql
ALTER TABLE tracium.spans DELETE WHERE name = 'huge.tokens';  -- 0 rows remain
SELECT cost FROM tracium.metrics_daily WHERE tenant_id = 'affected-tenant';
-- 3458764513820.541   ← still there
```

## The repair

`scripts/repair-rollup.sh` rebuilds specific `bucket_date` days from the raw
spans, using the same aggregation the materialized view performs.

```bash
# 1. Remove the bad spans from the raw table.
clickhouse-client --query "ALTER TABLE tracium.spans DELETE WHERE <predicate>"

# 2. Inspect what the rebuild would do — changes nothing.
./scripts/repair-rollup.sh --from 2026-07-14 --to 2026-07-16 --dry-run

# 3. Rebuild those days.
./scripts/repair-rollup.sh --from 2026-07-14 --to 2026-07-16
```

Step 1 must complete before step 2. The rebuild reads whatever is in
`tracium.spans` at the time it runs, so a span still present is faithfully
re-aggregated back into the rollup.

Run `./scripts/repair-rollup.sh --help` for the full option list.

## What the script protects you from

It refuses to run rather than write aggregates it cannot vouch for:

- **Schema drift.** Migrations use `CREATE TABLE IF NOT EXISTS`, so a long-lived
  deployment's tables can differ from the schema files. Every run compares the
  live `metrics_daily` layout *and* the live view's `SELECT` against what the
  script mirrors, and aborts on any mismatch.
- **Still-open days.** Rebuilding a day that is still receiving spans
  double-counts them — the view inserts a partial for each new span and the
  rebuild reads it too. Days with recent arrivals are refused unless you stop
  ingestion and pass `--force`. Late spans arriving *after* a rebuild are fine:
  the view adds them on top, exactly as it would have.
- **Aged-out days.** If a day's raw spans have already expired under the spans
  TTL, rebuilding would replace real history with an empty day — the rollup
  deliberately outlives raw spans. Such days are skipped unless you pass
  `--allow-empty`.

## Cost

Bounded by the days you request, never by the table size — the span read is a
half-open `start_time_ms` range that prunes on the sort key. There is no
"rebuild everything" mode; at Tracium's scale bar that would be unrunnable.

## Prevention

Ingest-side bounds (token ceilings, and ignoring client-reported cost unless
explicitly trusted) stop this class of poison from being priced and stored in
the first place. This script is for cleaning up damage already done.

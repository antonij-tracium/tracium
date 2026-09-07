# Plan — Reconcile metric-derived cost in the daily rollup (bug 1)

## The bug

The headline **Cost** KPI and the **cost series** disagree between short and long
date ranges, and a *wider* range can report *less* cost than a narrower one.

- **Short windows** (`!MetricsFilter.UseRollup()`) read raw spans and reconcile
  the two ingestion sources per bucket:
  `costWindow` scans `source IN ('span','metric')` and
  `costReconcileExpr = greatest(sumIf(cost_usd, source='span'), sumIf(cost_usd, source='metric'))`
  (`api/internal/query/metrics.go`). Each source is a lower bound on true spend,
  so the per-bucket `greatest` is the tightest non-double-counting estimate.
- **Long windows** (90d/1y) switch to the rollup. `tracium.metrics_daily` is
  filled by a materialized view that filters **`WHERE source = 'span'`**
  (`collector/schema/003_create_metrics_daily_mv.sql:40`). Metric-derived spend
  never reaches the rollup, so `kpiWindowRollup` / `costSeriesRollup` sum span
  cost only.

When the metric source meters more than spans (sampled spans, streamed calls
without usage on the span), the long-window total is **lower** than the
short-window total for an overlapping range. Hence "wider range shows less cost".

## Chosen approach

Reconcile in the rollup so long windows apply the *same* per-bucket
`greatest(span, metric)` reconciliation as the short path — at **day** grain,
which is exactly the bucket the long-window charts already use.

Metric rows have **no** trace / agent / model identity, so they cannot join the
existing `metrics_daily` aggregation (they would corrupt `runs`, `error_runs`,
and the agent/model dimensions — the very reason 003 excludes them). Instead,
add a **separate, cost-only daily table keyed by the dimensions metric rows
actually have** — `(bucket_date, user_id, workspace_id)` — with span and metric
cost in two columns, and reconcile at read time.

Scope note: only the **overall** cost KPI and the **unfiltered** cost series
reconcile on the short path. The per-agent / per-model / per-user cost lists are
span-attributed on *both* paths (metric rows carry no agent/model/user-run
identity), so they stay span-only and are **not** changed. This fix touches the
overall cost total only — matching precisely which short-path queries reconcile
today.

## Changes

### 1. Collector schema — new cost rollup table (migration `007`)

`collector/schema/007_create_metrics_daily_cost.sql` (single CREATE statement,
per the migration runner's one-statement-per-file rule):

```sql
CREATE TABLE IF NOT EXISTS tracium.metrics_daily_cost (
    bucket_date  Date,
    user_id      String,
    workspace_id String,
    span_cost    SimpleAggregateFunction(sum, Float64),
    metric_cost  SimpleAggregateFunction(sum, Float64)
) ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(bucket_date)
ORDER BY (bucket_date, user_id, workspace_id);
```

`SimpleAggregateFunction(sum)` stores the final value; reads just `sum()` across
merged parts. No `uniq`/merge state needed — cost is additive.

### 2. Collector schema — materialized view over BOTH sources (migration `008`)

`collector/schema/008_create_metrics_daily_cost_mv.sql`:

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS tracium.metrics_daily_cost_mv
TO tracium.metrics_daily_cost AS
SELECT
    toDate(start_time_ms / 1000)             AS bucket_date,
    user_id,
    workspace_id,
    sumIf(cost_usd, source = 'span')         AS span_cost,
    sumIf(cost_usd, source = 'metric')       AS metric_cost
FROM tracium.spans
GROUP BY bucket_date, user_id, workspace_id;
```

Note: no `WHERE source =` filter — the `sumIf`s split the two sources into their
own columns, so a single row per (day, user, workspace) holds both. This MV
fires on the same inserts as `metrics_daily_mv`; both writing to the spans table
is fine (independent targets).

### 3. One-time backfill (docs + release note)

An MV only captures inserts made *after* it exists. Backfill once, immediately
after creating the table (bounded by the spans TTL — older raw spans are already
gone, and the pre-existing rollup already covers span cost for them):

```sql
INSERT INTO tracium.metrics_daily_cost
SELECT toDate(start_time_ms/1000), user_id, workspace_id,
       sumIf(cost_usd, source='span'), sumIf(cost_usd, source='metric')
FROM tracium.spans
GROUP BY 1, 2, 3;
```

Document in the migration file header (mirroring 003's backfill note) and in
`deploy/docs/upgrading.md`.

### 4. API read path (`api/internal/query/rollup.go`)

Reconcile per day, then sum — the day-grain analog of the short path.

- **New helper** for a reconciled window total:

  ```go
  // costTotalRollup sums per-day greatest(span,metric) over the window — the
  // rollup analog of costTotal's per-bucket reconciliation (see costReconcileExpr).
  func (r *ClickHouseRepository) costTotalRollup(ctx context.Context, user string, workspaces []string, lo, hi time.Time, hiInclusive bool) (float64, error) {
      clause, args := rollupWindow(user, workspaces, lo, hi, hiInclusive)
      var cost float64
      q := fmt.Sprintf(`SELECT sum(day_cost) FROM (
          SELECT greatest(sum(span_cost), sum(metric_cost)) AS day_cost
          FROM tracium.metrics_daily_cost WHERE %s GROUP BY bucket_date)`, clause)
      // ... Scan(&cost); return sanitize(cost), nil
  }
  ```

- **`kpiWindowRollup`**: stop reading `sum(cost)` from `metrics_daily`. Keep the
  `runs`/`error_runs` query there (span-derived, unchanged) and fetch cost from
  `costTotalRollup` — exactly how the short path splits `costTotal` out of
  `kpiAggregates`. `rollupKPI.cost` is then the reconciled value.

- **`costSeriesRollup`**: read the reconciled per-day series:

  ```sql
  SELECT toInt64(bucket_date) * 86400000 AS bucket_ms,
         greatest(sum(span_cost), sum(metric_cost)) AS value
  FROM tracium.metrics_daily_cost WHERE <rollupWindow> GROUP BY bucket_ms
  ```

  (`bucketMsExpr` already yields UTC-midnight epoch-ms, lining up with the
  zero-fill axis — reuse it.)

- **Unchanged**: `topAgentsRollup`, `listAgentsRollup`, `modelCostsRollup`,
  `userUsageRollup`, `agentUsageRollup`, `failuresRollup` — all span-attributed,
  consistent with their short-path counterparts.

## Invariants preserved

- **No metrics deployed** → every `metric_cost = 0` → `greatest(span, 0) = span`
  → byte-identical to today's span-only rollup. Zero risk for span-only installs.
- **KPI == sum of chart**: both use per-day `greatest` on the same day grid, the
  same property the short path guarantees per bucket.
- **No double-counting**: `greatest` never adds the two sources, matching
  `costReconcileExpr`.

## Testing

- Unit: extend `api/internal/query/metrics_window_test.go` with a rollup case
  where `metric_cost > span_cost` on some days and `<` on others; assert the
  window total equals `Σ_day greatest(span, metric)` and that the KPI equals the
  cost-series sum.
- Regression: a rollup fixture with only span rows must match the current
  span-only output exactly.
- Cross-path continuity: for a range near the short/long boundary, the last
  short-window total and the first long-window total should be within
  bucket-granularity of each other (they now use the same reconciliation).

## Migration / rollout order

1. Ship 007 + 008 (collector migrations run as the Helm migrate Job / compose
   migrate service — idempotent `IF NOT EXISTS`).
2. Run the backfill once (Job hook or documented manual step).
3. Deploy the API change. Safe to deploy API before backfill completes: an empty
   `metrics_daily_cost` yields 0 for both sources → cost reads 0 for long windows
   until backfill lands, rather than a wrong number. (If that transient is
   unacceptable, backfill before rolling the API.)

## Decisions taken (as implemented)

- **Backfill**: left as a documented manual step (parity with 003), written up in
  `deploy/docs/upgrading.md`. Not automated into the migrate Job.
- **Retention**: `metrics_daily_cost` carries no TTL, matching `metrics_daily`,
  so long-horizon cost stays available after raw spans age out.

## Follow-up (done)

Because `metrics_daily_cost_mv` is also an insert trigger that does not retract
on DELETE, deleting a poisoned span leaves its contribution in
`metrics_daily_cost` just as it does in `metrics_daily`. Rollup repair is now the
`repair-rollup` command (`api/cmd/repair-rollup`, logic + guards in
`api/internal/rolluprepair`, unit-tested), which rebuilds **both** rollups for
the affected days with the same open-day / aged-out / drift guards. It replaces
the former `scripts/repair-rollup.sh`. See `rollup-repair.md`.

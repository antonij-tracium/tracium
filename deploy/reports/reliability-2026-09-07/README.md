# Further reliability assessment — 2026-09-07

Scope: server-side correctness for trusted-team self-hosting. SDK work and
previous findings are excluded. Three further findings are supported below.
Application code was not changed.

## P1 — Replaying a span inflates cost and tokens in both storage layers

Locations: `collector/schema/001_create_spans.sql:111`,
`collector/internal/writer/clickhouse.go:54`,
`collector/exporter/clickhousespanexporter/factory.go:120`.

The default schema uses plain MergeTree and the writer appends rows without
an application-level idempotency check. The exporter retries failed writes.
If a write commits but its acknowledgement is lost, a retry can insert the same
span again. Raw cost and token queries sum every row, and the materialized view
adds every insert to the historical rollup.

A real ClickHouse 24.6 process loaded the current three schema files, inserted
one $1/100-input-token span, then inserted an exact copy of that stored row.
Results were two rows, one unique span, $2 and 200 input tokens. The rollup also
contained two spans, one unique trace, $2 and 200 input tokens. The running engine
reported `non_replicated_deduplication_window = 0`.

This proves duplicate storage and aggregation under the default schema. It did
not inject a lost acknowledgement into the collector's network connection; the
retry trigger is established from exporter/writer configuration. External
deployments with additional deduplication settings may behave differently.

Required correction: define a retry/idempotency contract that covers raw inserts
and rollups, including stable identity across retries and any batch regrouping.
Merely deduplicating a read of raw spans does not remove already-added rollup
contributions. Validate committed-write/lost-acknowledgement recovery and
overlapping/rebatched retries. ClickHouse's
[insert retry guide](https://github.com/ClickHouse/clickhouse-docs/blob/main/docs/guides/developer/deduplicating-inserts-on-retries.md)
explains the engine deduplication controls and their limits.

## P1 — Aggregate metric pricing applies per-call tier rules to interval totals

Locations: `collector/processor/traciumprocessor/metrics.go:159`,
`collector/processor/traciumprocessor/metrics.go:221`,
`collector/internal/pricing/static.go:143`.

The processor treats a histogram's total token sum as one call when selecting a
long-context pricing tier. The price schedule is not linear across those tier
boundaries. Separately pricing an output point also loses the input size needed
to select that call's output tier.

Tests used the repository's actual pricing file and resolver for `gemini-2.5-pro`:

| Scenario | Per-call pricing total | Metric processor total |
| --- | ---: | ---: |
| Two calls, each with 150,000 input tokens; one histogram with count 2 and sum 300,000 | $0.375 | $0.750 |
| One call with 250,000 input and 1,000 output tokens, represented by separate input/output points | $0.640 | $0.635 |

These are comparisons against the repository's configured price schedule, not
claims about a provider's current billing rates. The points are within ingest
bounds and represent ordinary direct OTLP data; SDK implementation is irrelevant.
The short-range API's greatest-of-span-and-metric cost policy can preserve the
overestimate even when accurate spans are also present.

Required correction: apply tiered prices only when per-call input size or an
explicit pricing-tier dimension is available. Aggregate sum/count alone cannot
recover how many calls crossed a threshold; dividing by count is not a general
solution. For insufficiently attributed metrics, expose the estimate/coverage
limitation rather than allowing it to silently override exact per-call cost.

## P2 — Rollup repair can double-count concurrent arrivals

Locations: `deploy/scripts/repair-rollup.sh:217` and
`deploy/scripts/repair-rollup.sh:258`.

The script accepts a day once its last observed arrival is older than the
quiescence threshold. It does not establish an ingestion pause or lock. It then
deletes the day's rollup rows and rebuilds them in separate statements. A span
arriving between those statements contributes through the materialized view and
is included again by the rebuild SELECT.

The actual shell script was exercised with an offline curl fixture modelling
that interleaving. No force flag was supplied. The current day, with its last
arrival 600 seconds ago, passed the 300-second guard. The control run rebuilt one
span correctly; the race run ended with two raw spans and three rollup spans,
while returning exit code 0 and printing completion. No real database was
modified by this simulation.

Required correction: require an effective pause/drain of writers for the affected
data while rebuilding, or implement a consistent staging/cutover protocol that
accounts for concurrent inserts. A quiet-period observation, including one for
a closed day, cannot exclude a later arrival during the repair itself.

## Evidence and reproduction

- [Real ClickHouse replay results](replay-output.jsonl).
- [Exact schema and replay SQL](replay-input.sql).
- [Tier-pricing test output](pricing-probes.txt).
- [Repair simulation result](repair-race.json), [control log](repair-control.txt),
  and [race log](repair-race.txt).
- [Reproduction instructions](../../tests/reliability-review/README.md).

The ClickHouse test used an already-cached image with ID
`sha256:4f64ecdda1b9cacf41281ba3ed4b0cdf15040e2600021a22f3e16c1dba8834f1`,
networking disabled, one CPU and a 512 MiB memory cap. It created its own local
database inside an automatically removed container. Existing services were not
changed. Pricing tests used cached Go dependencies and a source overlay. The
repair fixture intercepts curl only for its child process and makes no network
requests. Passing diagnostic assertions mean the defects were reproduced.

Retention was also reviewed: the chart and schema document that changing an
existing table's TTL requires a manual ALTER. That documented creation-only
behavior is not counted as an additional blocker here. No host/node failure,
scale benchmark, or production-data test was attempted.

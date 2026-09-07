# Self-hosted production assessment — 2026-09-07

Scope: trusted-team self-hosting, excluding the SDK and previously reported
security findings. This pass found two release/correctness blockers and two
operational defects. The Helm findings do not block a Compose-only deployment.
No application code was changed.

## P1 — Long-range dashboards omit metric-derived spend

Locations: `collector/schema/003_create_metrics_daily_mv.sql:40`,
`api/internal/query/metrics.go:173`, `api/internal/query/rollup.go:76`.

For short ranges, the API reconciles span and metric cost using the greater of
their totals per bucket. For 90-day and one-year ranges, it switches to the daily
rollup. That rollup only receives `source = 'span'` rows, so metric-derived cost
is omitted entirely on the long-range path.

Source-derived example: a workspace with $100 of metric-only spend today and no
span spend would show $100 over 30 days and $0 over 90 days. With sampled spans,
the larger window can similarly understate spend. This applies to directly
submitted OTLP metrics and does not depend on the retiring SDK.

Evidence: inspection of the raw cost expression, materialized-view predicate,
rollup query and range dispatch; existing range-dispatch tests pass. This example
was not executed against ClickHouse in this pass.

Required correction: preserve both sources in the historical cost representation
and reconcile at consistent dimensions/time boundaries. Keep trace/run counts
span-derived. Validate with metrics-only, spans-only and mixed-source datasets
across 30-day, 90-day and one-year ranges, including raw-data expiry. Existing
historical metric totals may be unrecoverable if their raw rows have already
expired; a migration needs an explicit recovery policy.

## P1 — Published image tags and the packaged Helm chart disagree

Locations: `.github/workflows/release.yml:55`,
`deploy/helm/tracium/values.yaml:4`,
`deploy/helm/tracium/templates/_helpers.tpl:21`.

A `v0.1.0` release publishes component images tagged `v0.1.0` and `latest`. The
chart requests `0.1.0`. Later releases still request that hard-coded value unless
the operator overrides it: the tag helper uses `global.imageTag`, not the chart's
updated app version.

The published release therefore does not supply the image tag requested by its
default chart. A fresh installation can fail to pull, or an unrelated older tag
can be reused if one was published separately. The registry was not queried;
the confirmed defect is inconsistency within this repository's release pipeline.

Required correction: use one tag convention in image publishing and chart
packaging; bind chart defaults to that release while retaining explicit operator
overrides. Validate the packaged chart's rendered image references against the
tags produced for at least two distinct releases.

## P2 — Helm mounts API configuration that the process never reads

Locations: `deploy/helm/tracium/templates/api-deployment.yaml:75`,
`api/cmd/api/main.go:32`, `api/internal/config/config.go:167`.

The API pod mounts `/etc/tracium/api.yaml`, but its container does not set
`CONFIG_FILE`. The application only loads the path from that environment
variable; an empty path returns defaults. Changes to mounted auth/proxy settings,
timeouts and other recognized configuration therefore have no effect. Explicit
environment variables still apply.

Evidence: manifest/entrypoint/load-path inspection. This was not a live Helm test.
Required correction: explicitly select the mounted config and ensure config
changes restart or reload the application. Check a non-default setting through
the deployed API's behavior, not merely the contents of its ConfigMap.

## P2 — The configured query timeout is never enforced

Locations: `api/internal/config/config.go:45`,
`api/internal/query/clickhouse.go:209`.

`storage.query_timeout_seconds` is defaulted to 10 and validated, but no runtime
code consumes `QueryTimeout`. Repository methods pass through request contexts
without applying that configured deadline. A slow query can therefore exceed the
operator's chosen database-query budget and occupy resources until another
independent timeout or cancellation occurs.

A local database/sql probe passed an ordinary HTTP-request context through
`GetSpans` and observed no deadline at the driver boundary. The driver stopped
immediately without network/database activity. This proves the missing deadline;
it does not simulate a database outage or measure eventual driver timeouts.

Required correction: propagate the configured duration and enforce it around
database operations, including scan/iteration. Verify a deliberately slow query
cancels within the configured budget and releases its resources. Apply this
independently of the HTTP server's write settings.

## Evidence and reproduction

- [Static consistency checks](static-checks.json).
- [Query deadline probe and existing query controls](query-probes.txt).
- [Checked source fingerprints](source-sha256.json).
- [Local reproduction instructions](../../tests/self-hosted-review/README.md).

The tests use cached Go dependencies with network fetching disabled. Docker,
Kubernetes, external audit services and SDK code were not exercised. No live
datasets were modified. Passing diagnostic probes confirm the observed defect;
they are not security or production acceptance passes.

# Production readiness checks — 2026-09-06

**The current build has reproducible data-loss and operational defects. A general
production-ready claim is not supported yet.** Publishing the source as OSS is
still possible with these limitations disclosed. Release maturity should follow
the tested guarantees and supported deployment scope.

These checks added validation scripts and evidence; they did not change product
behavior to make failures pass. Nothing was published or committed.

## Results

| Check | Outcome | Evidence |
| --- | --- | --- |
| Sustained OTLP ingestion | Passed within tested envelope | 59,600 submitted, accepted, stored and unique spans in 120.2 s; 495.8 spans/s; HTTP acceptance p95 12.73 ms. |
| Six-minute ClickHouse outage plus collector crash | Passed for already queued batches | 1,000 accepted spans recovered after 360.4 s; collector killed after the batch timeout. |
| Crash immediately after OTLP acknowledgement | **Failed** | One span acknowledged; collector killed before its batch flushed; zero stored after restart. |
| Queue disk exhaustion | **Failed twice** | HTTP 200 for 500 spans with a full queue filesystem; zero stored after space and ClickHouse recovered. |
| Modified JWT | Passed for this case | API returned HTTP 401. This is not an exhaustive authentication review. |
| Public authentication abuse controls | **Failed** | Invalid email and one-character password registered with 201; 30 wrong-password attempts all returned 401, with no throttling observed; a 100-byte password caused 500. |
| Dependency readiness | **Failed** | `/v1/ready` returned 200 while ClickHouse was stopped. |
| 100,000-row synthetic queries | Passed on rerun | 12 requests per endpoint, all 200. Trace-list p95 55.24 ms; 24-hour KPI p95 26.68 ms; one-year KPI p95 7.99 ms. |
| One-million-row query scale | Incomplete: environment limit | Population stopped with ClickHouse `MEMORY_LIMIT_EXCEEDED`, maximum 921.60 MiB under the test's 1 GiB container cap. No query-scale conclusion at this size. |
| Backup restored into empty volumes | Passed twice | Initial: 160,600 rows. Rerun: 100,000 rows. Raw count, unique traces, input-token totals, rollup totals, login and membership matched. |
| Kubernetes deployment and PVC persistence | Incomplete | Initial kind setup was interrupted around the Docker crash. Cluster removed; retry preflight refused the 4 GiB Docker memory budget. No successful chart deployment or PVC restart test is claimed. |
| Offline dependency/image advisories | Requires remediation and reachability triage | Source scan found 3 critical and 19 high package/version/advisory matches after deduplication; actual images also had matches and outdated runtime metadata. These are not confirmed exploitable paths. |
| Git-history secret scan | One test-fixture finding | Gitleaks scanned two commits; the only finding was a fixed JWT value in a config unit test. The uncommitted tree was outside this Git-history scan. |

## Confirmed defects and the next acceptance criteria

1. **Collector acknowledgements precede durable storage.** Both immediate process
   death and a full exporter queue lost successfully acknowledged spans. The batch
   processor sits before the persistent exporter queue in
   [collector config](../../../collector/config/collector.yaml). The disk log
   reports `no space left on device` and `rejected_items: 500` after the HTTP
   response. Align successful acknowledgement with durable enqueueing, propagate
   storage pressure to senders, and rerun both fault tests. Persistent storage
   after the batch processor does not cover data still held by that processor.
2. **Public authentication needs input validation and abuse protection.**
   [Credential decoding](../../../api/internal/handler/auth.go) only checks for
   empty fields. Define and enforce email/password rules, reject oversized input
   with a client error, and add documented login/registration throttling. Thirty
   attempts without a 429 alone cannot exclude a higher configured limit; source
   inspection and this bounded behavior test do not establish comprehensive abuse
   protection.
3. **Readiness must reflect required dependencies.**
   [The ready handler](../../../api/internal/handler/health.go) unconditionally
   returns success. Test ClickHouse and Postgres outages independently after
   implementing readiness; liveness should remain a separate signal.
4. **The Helm installation path has static defects.** API, collector and migration
   manifests reference a release-named `*-db` secret containing DSNs, but no chart
   template creates it and the [install instructions](../../README.md) only create
   three other secrets. The [ClickHouse probes](../../helm/tracium/templates/clickhouse-statefulset.yaml)
   omit authentication while configuring a password. Resolve those gaps, then test
   a fresh install, migrations, upgrade, ingress, and PVC persistence on a suitable
   Kubernetes environment. These findings come from inspection, not a completed
   cluster test.
5. **Refresh and triage runtime dependencies.** The collector image was compiled
   with Go 1.22.12. Trivy marked the API, collector and migration Alpine 3.19.9
   runtimes as end of support. The dashboard image also had critical/high advisory
   matches. Refresh base images and compiler/framework versions, rebuild, rescan,
   and evaluate actual reachability before assigning exploitable-vulnerability
   counts. Source matches include development dependencies and unused package
   paths; counts across images overlap.

## Scope and limitations

Tests used disposable Compose projects with separate volumes and random loopback
ports. Docker had 8 CPUs and approximately 4 GiB RAM, shared with existing
services. The test ClickHouse was capped at 1 GiB, collector at 384 MiB, API at
256 MiB, and Postgres at 192 MiB. Disk exhaustion filled only a private 16 MiB
collector tmpfs. It did not fill the host filesystem.

The two-minute load run used small spans with 256-byte random content, one span
per trace, two concurrent requests of 100 spans, paced to 500 spans/s. It establishes
that envelope only. It does not establish maximum throughput, durable latency,
long-duration stability, high-cardinality behavior, or concurrent dashboard load.
The synthetic query test uses 100 user labels and sequential reads. The initial
100,000-row run had five trace-list 500s out of twelve requests; the clean rerun
passed all twelve. The cause of the initial intermittent errors is not proven.

Backup validation used a stopped ClickHouse volume archive and Postgres
`pg_dump`/`pg_restore`, with ingestion/API writes paused. It proves a cold restore
of this small test dataset, not online backup, point-in-time recovery, an RPO/RTO,
or large-dataset recovery.

Kubernetes resource exhaustion occurred during validation; it is not evidence of
an application crash. After Docker recovered, the leftover kind node was removed
and the two previously running Tracium databases were restarted. Existing API and
collector containers recovered, and the disposable follow-up stack was removed.
The Kubernetes harness now requires at least 6 GiB Docker memory and 8 GiB free
host disk before creating a cluster. Larger-scale and Kubernetes validation remain
outstanding.

The requested external npm dependency audit was skipped. The prior advisory check
downloaded a public database without mounting source, then scanned locally using
containers with networking disabled. No repository dependency inventory was sent
to an advisory service. This was an advisory scan and bounded auth review, not a
penetration test or complete security audit.

## Evidence and reproduction

- [Sanitized rerun results](results.json) contain auth, immediate crash, synthetic
  queries, queue exhaustion, backup and Kubernetes-preflight evidence.
- [Pre-restart observations](pre-restart-observations.json) retain the measured load,
  prolonged outage and original restore results from tool output. Their original
  temporary raw files were no longer present after the Docker restart.
- [Security observations](security-observations.json) retain scanner versions,
  database timestamp, counts and limitations from the original tool results.
  Their raw reports were also lost; these are explicitly transcribed observations.
- [Source fingerprints](source-fingerprints.json) identify key checked files. The
  repository was already dirty; a Git commit alone would not identify this build.
- [Harness instructions](../../tests/production/README.md) explain how to repeat the
  checks. Rerun logs are in the ignored local `raw/` directory, including the
  ClickHouse memory error and collector queue-write failure.

The first immediate-crash attempt did not receive an acknowledgement because it
used a stale random port after restarting the collector; it was inconclusive.
The harness now refreshes the port and requires acceptance before evaluating
recovery. The rerun reproduced loss of an acknowledged span. The runner returns
a nonzero exit when checks fail or are incomplete; expected fault findings are
recorded as such rather than treated as passing commands.

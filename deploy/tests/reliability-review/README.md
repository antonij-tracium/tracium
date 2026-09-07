# Reliability review reproductions

From the repository root:

```sh
bash deploy/tests/reliability-review/run.sh
```

Requires Docker with `clickhouse/clickhouse-server:24.6` already cached, Python 3,
Go and cached Go dependencies. The image is never pulled. The disposable
ClickHouse local process has no network, one CPU and a 512 MiB memory cap. It
loads the repository schemas and replays one synthetic row. No existing database
is contacted. `RELIABILITY_REPORT_DIR` may select an absolute output directory.

The pricing probes use a Go overlay to execute tests against the current
processor and the repository pricing file without modifying application files.
Go dependency fetching is disabled. The repair test runs the actual repair shell
script with an offline transport fixture; it does not execute SQL on a database.
It can also be run separately:

```sh
python3 deploy/tests/reliability-review/repair-race.py
```

**These are diagnostic reproductions, not passing production acceptance tests.**
Pricing and repair assertions pass when the reported defects are present. Replay
results are recorded for inspection. After remediation, add regression tests in
the relevant application packages that require the corrected outcomes.

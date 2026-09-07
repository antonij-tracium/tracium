# Local security assessment probes

Run from the repository root:

```sh
bash deploy/tests/security/run-local.sh
```

Requires the existing Go module cache, Node, and the installed dashboard
TypeScript dependency. Network dependency fetching is disabled. The runner uses
Go's file overlay to add review tests without editing application packages, and
executes the current auth TypeScript in an isolated VM with placeholder tokens.
It does not start Docker, contact a database, or send requests to a deployed app.

**These are diagnostic reproductions: a passing probe confirms the reported
vulnerable behavior. They are not passing security acceptance tests.** After
remediation, these assertions should stop passing; replace them with regression
tests that require the corrected behavior in the relevant application packages.

Fixtures are kept as `.go.txt` files so normal test runs do not execute them.
`SECURITY_REPORT_DIR` can select an absolute output directory; the default is
`deploy/reports/security-2026-09-07`. The generated overlay contains local paths
and is ignored in that report directory.

The membership reproduction uses a mock lookup and store to demonstrate the
handler's immediate grant. The registration and database schema portions of that
finding are established by source inspection. The metrics reproduction stops at
the processor; the export/write path was inspected. The cache test retains only
10,000 short synthetic identifiers and does not attempt an actual OOM.

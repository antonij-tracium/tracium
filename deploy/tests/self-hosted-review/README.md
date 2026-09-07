# Local self-hosted assessment checks

From the repository root:

```sh
bash deploy/tests/self-hosted-review/run-local.sh
```

Requires Python 3, Go and cached project dependencies. Dependency network access
is disabled. `SELF_HOSTED_REVIEW_DIR` may select an absolute output directory.

The runner records source/config consistency observations and uses a Go overlay
to inject a diagnostic test into the query package without changing application
files. A fake database/sql driver observes the query context, then immediately
returns an error. It does not contact ClickHouse or start Docker. The existing
range-dispatch and workspace-scope query tests also run.

**The deadline probe passes when it reproduces the missing deadline.** After a
fix, replace it with an application regression test that requires the configured
deadline and verifies cancellation. Static checks do not execute Helm templates
or SQL and should be interpreted with the report's stated limitations.

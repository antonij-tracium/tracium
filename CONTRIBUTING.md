# Contributing to Tracium

Thanks for helping. This is the OSS core (Apache 2.0). Enterprise features live in
a separate private repo and are out of scope here.

## Repo layout

One repository, five components: `collector/` and `api/` (Go), `dashboard/`
(React/TS), `spec/` (schemas + codegen), `deploy/` (Helm, migrations, infra).
Each has a `README.md` documenting its conventions — read the relevant one before
changing that component.

## Build & test

```bash
make test            # go tests (collector, api) + dashboard tests
make up              # run the full stack from source
make build-collector # assemble the OSS collector via OCB
```

The Go modules are wired with `go.work`, so cross-module builds resolve locally
with no version pins.

## Ground rules (from the design docs)

- **Program against interfaces**, wire concrete types in one place (`main.go` /
  provider setup).
- **Typed errors** from `internal/errors` — never bare `fmt.Errorf`/`new Error` out
  of a pipeline stage or repository.
- **`spec/` is the source of truth.** Change a shared type there first, then
  regenerate consumers — never hand-edit generated files.
- **Every read must be time- or trace-bounded.** Nothing may scan the span table
  unbounded; cost scales with the query window, not total rows stored.
- **No Enterprise features** (SSO, RBAC, PII redaction, budgets) in this repo.

## Pull requests

Keep PRs focused. Include tests (unit tests use mocks, never a real DB). CI runs
the affected component's tests and checks that generated code is in sync.

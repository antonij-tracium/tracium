# Composing applications

The standalone API and dashboard are also reusable packages. Keep shared behavior
here and import it from another application. Extensions should not copy core
handlers, pages, or database migrations.

## API

Import `github.com/tracium/api/app`, `extension`, and `migrations`. Load configuration
with `app.LoadConfig()`, assemble with `app.New(ctx, cfg, options)`, and call
`Run(ctx)`. Cancel the context for graceful shutdown; defer `Close()` to release
stores. The standalone command uses this same assembly.

An `app.Extension` has a unique lowercase name. Its `Routes` callback receives a
Chi router mounted at `/v1/extensions/{name}` **after core authentication** and
shared `extension.Services`. Read the verified identity through
`extension.PrincipalFromContext`. A separate, explicitly public `Webhooks` handler
is mounted at `/v1/integrations/{name}`; it must verify provider signatures itself.
These mounts cannot shadow core routes.

`Services.RequireFeature` requires an explicit `workspace_id`, verifies core
workspace membership first, then calls `Entitlements.Check`. Provider errors fail
closed. Extension handlers must separately check ownership of billing accounts or
other extension resources. Neither global JWT roles nor billing roles replace
workspace access checks. Core data endpoints retain their existing access rules.

`Mailer.Send` accepts a stable message ID. A durable implementation should queue
and deduplicate delivery. The default mailer returns `ErrMailDisabled`, never false
success. Default entitlements permit core trace/metric reads and deny unknown
features. Add interfaces only when a real integration requires them.

## Dashboard

Run `npm ci && npm run build:library` in `dashboard/`. The package exports
`TraciumApp`, `Dashboard`, `SettingsPage`, providers, API client utilities, and
extension types. Import `tracium-dashboard/style.css` alongside the package.
The existing `npm run build` continues to build the standalone website.

```tsx
import { TraciumApp, type DashboardExtensions } from 'tracium-dashboard';
import 'tracium-dashboard/style.css';

const extensions: DashboardExtensions = {
  pages: [{ id: 'extension:reports', label: 'Reports', component: ReportsPage }],
  settingsSections: [{ id: 'extension:reports', label: 'Reports', component: ReportSettings }],
};
// <TraciumApp extensions={extensions} />
```

`authAppearance` can override the login/signup tagline and footer while preserving
shared authentication behavior.

`signupFields` renders a component inside the signup form, above the submit
button (for example a CAPTCHA widget). It receives `onChange(fields)` and
`attempt`, which increments after each failed submission so single-use values
can be refreshed. The reported values are sent as `extensions` in the
`POST /v1/auth/register` body. The core API ignores them, so the embedding
application must check them itself, for example in middleware wrapping
`Application.Handler`.

Pages use `/extensions/{name}` deep links, including login redirects and browser
history. They receive the active workspace and a navigation callback. Set
`requiresWorkspace: true` for workspace-dependent pages. Account-level pages can
render before the first workspace exists. Settings sections receive the active
workspace. An optional `onboarding` component wraps the authenticated dashboard
and renders its `children` once setup is complete. Declare extensions once at app
assembly; don't change registration while mounted. Use one React and React Query
runtime in the consuming app (Vite `resolve.dedupe` is appropriate for local links).

## Migrations and versioning

Postgres migrations live in `api/migrations/sql`. `001_identity.sql` adopts existing
users/workspaces and backfills legacy owner memberships without replacing data.
Application startup applies these before constructing stores. Extensions supply
embedded `migrations.Set` values through `Options.Migrations`; each has a separate
namespace and runs after core. A transaction and advisory lock serialize migration
application. Checksums refuse changed, missing, or backdated applied migrations.
Append a new numbered file for every later change. Migration SQL must stay inside
the runner's transaction (no `BEGIN`, `COMMIT`, or nontransactional DDL).

`app_schema_migrations` tracks Postgres independently of the existing deployment
`schema_migrations` ledger used by ClickHouse. ClickHouse deployment and migration
files remain shared and run before the API starts.

Pin consuming applications to **one exact repository commit** for the API,
dashboard, collector, and schema. Test dependency updates as a unit. Shared fixes
belong here first; the dependent application advances its pin after compatibility
and upgrade tests pass. The extension API is still evolving: coordinate breaking
extension contract changes through that dependency update.

Run `go test ./...` in `api` and `npm test && npm run build && npm run build:library`
in `dashboard`. The migration test additionally uses `TEST_POSTGRES_DSN`; it resets
the public schema and must point to a dedicated disposable test database.

# Changelog

All schema and API changes are recorded here. Follow the format below when adding entries.
Breaking changes require a `schema_version` bump. Additive changes do not.

---

## [Unreleased]

### Added
- Node.js example that sends a GenAI-semconv trace without an LLM provider key (`examples/node`)

### Changed
- `docker compose up` pulls the release images pinned by `TRACIUM_VERSION`; `docker compose up --build` still builds from source
- The collector health check is published on host port `13133` instead of `8080`
- ClickHouse and Postgres are no longer published on the host by default; `make up` publishes them through `compose.dev.yaml`
- The dashboard package is marked `"type": "module"`

---

## [1.0.2] - 2026-10-01

### Added
- Release images are published for `linux/arm64` as well as `linux/amd64`, so they pull natively on Apple Silicon and ARM nodes

### Changed
- Dashboard text is one step larger throughout, and secondary text uses a lighter gray for higher contrast

---

## [1.0.1] - 2026-10-01

### Added
- Workspace invites by email with single-use shareable links (`/v1/workspaces/{id}/invites`, `/v1/invites/{token}`)
- `extension.InviteNotifier` hook for delivering invite links, and `email_sent` on the create-invite response
- Per-workspace member limits via the `workspaces.members.add` entitlement (`403 MEMBER_LIMIT_REACHED`)
- `GET /v1/workspaces/{id}/members` and a Members tab in Settings
- `POST /v1/auth/password` to change your password, with a matching Settings form
- `reset-password` admin CLI for self-hosted deployments
- `extension.Sessions` for issuing sessions to accounts an embedding app authenticated itself
- Dashboard auth extension points: `authRoutes`, `forgotPasswordHref`, `signInOptions`, `signupFields`
- Dashboard exports `AuthDivider`, `EMAIL_KEY`, `storeSession` and `readPendingInvite`
- Client detail page with spend, runs, failure rate, latency, models, workflows and recent traces
- Trace view header shows and links to the trace's client
- OpenAPI docs for the password endpoints, the register/login confirmation responses, and register's `extensions` field

### Changed
- Dashboard Users pages renamed to Clients (`/clients`; old `/users` links still work)
- Time range picker shows on the Clients pages and no longer on the trace page
- Workspace setup panel walks through API-key ingest instead of showing the workspace ID
- `POST /v1/auth/password` returns `409 NO_PASSWORD` for accounts without a password
- Security reports now go to antonij@tracium.ai

### Fixed
- Corrected the 1.0.0 pricing note: reported costs are used only when `TrustReportedCost` is enabled

---

## [1.0.0] - 2026-09-20

### Changed
- Renamed `agent` to `workflow` across storage, API, and dashboard (breaking; migration `011`)
- Renamed the metering dimension `tenant` to `user` (`tracium.user.id`, `user_id`; breaking)
- `pricing.json` is generated from LiteLLM's pricing table, with cache-token and long-context pricing
- `LatencyBucket` percentiles are nullable, and latency series are null-filled

### Added
- Optional email confirmation through the `extension.AccountLifecycle` hook
- Caller-scoped entitlement gate for user-wide features
- Per-workspace ingest API keys; ingest now requires a key
- Workspaces as the access boundary (`workspace_id`, memberships, workspace endpoints)
- `output_tokens_derived` and `unmetered` metering provenance flags on `Span`
- Agent (now workflow) list and detail endpoints, and an agent filter on series and traces
- `90d` and `1y` ranges served from a daily rollup table
- `kind` field on `Span`
- `GET /v1/metrics/error-series`
- `agent_name` storage column for grouping traces per agent
- OpenAPI docs for the cost-allocation metrics endpoints

---

## [v4] - Metrics Ingestion (Unified Spans Source)

### Added
- The collector ingests OTLP metrics (`gen_ai.client.token.usage`) into `tracium.spans`
- `source` storage column (`span` or `metric`)
- Cost and token totals prefer metric rows when present

---

## [v1] - Baseline Schema

### Added
- Initial span, trace and error schemas
- Pricing table
- OpenAPI spec v0.1.0 with traces, health and ready endpoints
- OTel GenAI and Tracium attribute definitions
- Codegen scripts

---

## [v3] - Span Content & Tools

### Added
- `input`, `output` and `available_tools` fields on `Span`
- Content and tool source attribute docs

---

## [v2] - Error Fields

### Added
- `error_type` and `error_message` fields on `Span`

---

## Overview Metrics Endpoints

### Added
- `GET /v1/metrics/kpis`, `cost-series`, `latency-series`, `top-agents` and `failures`
- Shared `range` and optional `tenant_id` query parameters

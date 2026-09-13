# Changelog

All schema and API changes are recorded here. Follow the format below when adding entries.
Breaking changes require a `schema_version` bump. Additive changes do not.

---

## [Unreleased]

### Changed
- **Renamed the metering dimension `tenant` → `user`.** `span.json` / `trace.json` `tenant_id` → `user_id`; the OTLP attribute `tracium.tenant.id` → `tracium.user.id`; the `tracium.spans` column `tenant_id` → `user_id` (skip index `idx_tenant` → `idx_user`) and the `metrics_daily` rollup column/sort key; the `GET /v1/traces` and `/v1/metrics/*` query param `tenant_id` → `user_id`; the endpoint `GET /v1/metrics/usage-tenants` → `/v1/metrics/usage-users`. A breaking wire/storage rename — instrumentation must emit `tracium.user.id`, and existing span volumes need the renamed column (this project is pre-release/local, so migrations recreate rather than migrate in place). `user_id` is now documented as a **metering/attribution label, not an access boundary**. The auth-layer tenant (the JWT `tenant_id` claim and the `users.tenant_id` column) is intentionally **unchanged**. Affects `collector`, `api`, `dashboard`, `examples`, `spec`.
- `pricing/pricing.json` is now **generated** from LiteLLM's community pricing table (via `pricing/refresh-pricing.sh`) instead of being hand-curated, so computed cost matches upstream (the same source Traceloop/tokencost use) for every major provider. The file shape changed (`version` 2): a model-keyed **object** (was a `models` array), **per-token** costs (was per-1k), with optional `cache_read_input_token_cost` / `cache_creation_input_token_cost` and long-context `tiers`. This is a pricing-data file, not a `span.json`/API schema, so no `schema_version` bump. The collector now prices prompt-cache tokens and long-context tiers the way providers bill them, reads token counts across both the OTel semconv (`input_tokens`/`output_tokens`) and OpenLLMetry legacy (`prompt_tokens`/`completion_tokens`) names, and honours an upstream-reported cost (`gen_ai.usage.cost` / `llm.usage.total_cost`) when present. Affects `collector` (pricing engine, token/cost extraction).
- `LatencyBucket.p50` / `p95` / `p99` are now `nullable` — additive, backward-compatible, no `schema_version` bump. `GET /v1/metrics/latency-series` is now null-filled over the full window (like cost- and error-series are zero-filled): every bucket is present so the x-axis lines up with the cost chart, but a bucket with no runs carries `null` percentiles rather than `0`. Latency is undefined when nothing ran, so the chart renders a genuine gap instead of a misleading dip to the floor. The fields stay `required` (always present, possibly null); existing clients that read them as numbers must tolerate `null`.

### Added
- **Per-workspace ingest API keys — ingest now requires a key.** New endpoints: `GET|POST /v1/workspaces/{id}/api-keys` (list; create returns the plaintext `trc_…` token **once**, storing only its hash + prefix), `DELETE /v1/workspaces/{id}/api-keys/{keyId}` (revoke), and the collector-facing `POST /v1/ingest/keys/verify` (resolves a presented key to its workspace, or 401; session-less but rate-limited). New `api_keys` table (Postgres migration 002). Additive API surface — no `span.json`/`trace.json` shape change, no `schema_version` bump. **Ingest is now key-only and mandatory:** the OSS collector's `traciumauth` authenticator is wired into both OTLP receivers and verifies every request against the endpoint above, rejecting unknown or revoked keys with **401**; the `tracium` processor fail-closes by dropping any span that reaches it unauthenticated. The key is the source of truth for the workspace — the collector stamps the key's workspace onto every span **and** metric point, overriding any sender-supplied `tracium.workspace.id`, so senders set only `Authorization: Bearer <key>` and no workspace attribute. The previous opt-in shared-token path (`bearertokenauth`) is removed. Set `INGEST_VERIFY_URL` so the collector can reach the API. Affects `api` (key store + endpoints + verify), `collector` (`traciumauth` extension, processor enforcement + workspace stamping, build), `dashboard` (API-keys screen), `deploy` (collector config, compose, Helm all require it), `examples` / seed / smoke (authenticate with a key), `spec`.
- **`workspace_id` — workspaces are now the access boundary.** New `workspace_id` field on `Span` and `Trace` (type: `string`) — additive, optional, no `schema_version` bump. Promoted to a `workspace_id String` column on `tracium.spans` (skip index `idx_workspace`) and added to the `metrics_daily` rollup key, filled from the OTLP `tracium.workspace.id` attribute (span- or resource-level); pre-migration rows read back `''`. A **workspace is the access-control unit**: a new `workspace_members` table (Postgres) maps accounts to workspaces (`owner` / `member`). Every `GET /v1/traces` and `/v1/metrics/*` read is scoped by membership — an optional `workspace_id` query param narrows to one workspace (**403** if the caller is not a member), and with none the read covers exactly the caller's workspaces (an account that is a member of none sees nothing, never everything). New endpoints: `GET|POST /v1/workspaces`, `DELETE /v1/workspaces/{id}`, and owner-only `POST /v1/workspaces/{id}/members` / `DELETE /v1/workspaces/{id}/members/{userId}`; `GET /v1/workspaces` returns the caller's workspaces with their own role and the member count. `GET /v1/metrics/usage-users` remains the per-user (metering) cost breakdown, which is a different axis. `spec/api/openapi.yaml` now also documents the previously-omitted `POST /v1/auth/register` and `/v1/auth/login`. Affects `collector` (schema 001/002/003 + attribute promotion), `api` (column, filter, membership store + read enforcement, endpoints), `dashboard` (workspace switcher scopes every read), `spec`.

  > **Known gap:** single-trace-by-id reads (`GET /v1/traces/{id}` and `/v1/traces/{traceId}/spans`) are not yet workspace-checked; the dashboard only reaches them via the scoped listing, but a direct call with a known trace id currently bypasses the boundary.
- `output_tokens_derived` and `unmetered` fields on `Span` (type: `boolean`) — additive, optional, no `schema_version` bump. Both record **metering provenance**: how much of a span's usage the provider actually reported, as opposed to what Tracium inferred or could not know. Stored as `UInt8 DEFAULT 0` columns on `tracium.spans`; pre-migration rows read back as `0`.

  `output_tokens_derived` marks an `output_tokens` count that was partly reconciled from `gen_ai.usage.total_tokens` rather than reported whole. Google bills Gemini `thoughts_token_count` at the output rate, but OpenLLMetry maps only `candidates_token_count` onto `gen_ai.usage.output_tokens` — on a measured call, Google billed 795 output tokens (213 visible + 582 thinking) where Tracium stored 213. The collector now attributes the unexplained remainder of `total_tokens` to output, and flags that it did so, so a derived count is never mistaken for a provider-reported one. Reconciliation is one-sided: it can under-count but never over-bill.

  `unmetered` marks a span that returned a completion but carried **no** `gen_ai.usage.*` attributes at all, so its `cost_usd` of `0` is *unknown*, not free. The common cause is a streamed OpenAI call made without `stream_options={"include_usage": True}` — the span lands with full content and looks tracked, but bills $0 forever. Tracium flags the shape rather than estimating tokens from captured content, which would be lossy. **Consumers must not read `cost_usd = 0` on a flagged span as $0 of real spend.**
- `GET /v1/metrics/agents/{name}` — one agent's detail-page payload, powering the dashboard's agent detail view. Returns `AgentDetail` (`name`, `calls`, `cost`, `avg_latency_ms`, `p95_latency_ms` (nullable), `error_rate`, `input_tokens`, `output_tokens`, `model`, `provider`, `tools`, `last_trace_id`) plus the `AvailableTool` schema. Additive, backward-compatible, no `schema_version` bump. **Span-backed only:** there is no agent-config store, so runtime params (temperature, max_tokens, timeout, retries, version, owner, team) are intentionally not served — the dashboard's configuration panel trims to the model/provider/tokens/tools it can source. The tool surface is the union of `available_tools` from the agent's most recent run; `provider` is inferred from the model id. **Caveat:** a raw-window feature — ranges longer than 30d (`90d`/`1y`) are rejected with `400`, since per-agent latency can't be derived from the daily rollup. Affects `api` (new endpoint) and `dashboard` (agent detail page).
- `agent` query parameter on `GET /v1/metrics/cost-series`, `latency-series`, `error-series`, and `GET /v1/traces` — additive, optional, backward-compatible, no `schema_version` bump. Restricts the metric/listing to a single derived agent (the agent detail page's charts and recent-runs list), using the same `agent_name` derivation as the other agent metrics. **Caveat:** on the series endpoints the agent filter is a raw-window feature — `90d`/`1y` are rejected with `400` (per-agent latency isn't in the rollup); the `/v1/traces` filter is unrestricted (already window-bounded).
- `GET /v1/metrics/agents` — every active agent in the range with its run count, total spend, mean run latency, error rate, and call-count sparkline, powering the dashboard's Agents page. Returns `PaginatedAgentResponse` of `Agent` (`name`, `calls`, `cost`, `avg_latency_ms`, `error_rate`, `trend`). Additive, backward-compatible, no `schema_version` bump. Agents are derived (like top-agents/failures) from `agent_name`; rows are ordered by call count and capped server-side, with sorting/filtering done client-side. **Caveat:** `avg_latency_ms` is `0` for `90d`/`1y` windows served from the daily rollup (per-trace durations aren't retained, same limitation as `kpis.latency_p95`); `error_rate` over those windows uses approximate `uniq` run counts. Affects `api` (new endpoint + rollup path) and `dashboard` (Agents page).
- `range` query parameter now accepts `90d` and `1y` (in addition to `24h`/`7d`/`30d`) — additive, backward-compatible, no `schema_version` bump. These long ranges are bucketed daily and served from the new daily rollup table (`tracium.metrics_daily`, an `AggregatingMergeTree` filled by a materialized view on `tracium.spans`), so a year-wide query reads ~(days × dimension cardinality) rows instead of every span in the window — read cost tracks cardinality, not span volume. Affects every `GET /v1/metrics/*` endpoint. **Caveat:** latency percentiles cannot be derived from the rollup (they need per-trace durations), so `GET /v1/metrics/latency-series` returns a null-filled axis and `kpis.latency_p95` is neutral for `90d`/`1y`; the dashboard hides the latency panel/tile at those ranges. Run counts in the rollup use approximate `uniq` (~1%, HyperLogLog). Affects `collector` (schema migrations 002/003), `api` (rollup query path), and `dashboard` (range selector).
- `kind` field on `Span` (type: `string`, enum: `agent`/`llm`/`tool`/`chain`/`retriever`/`embedding`) — additive, optional, no `schema_version` bump. The normalized span role, derived by the collector from instrumentation attributes with this precedence: (1) OpenInference `openinference.span.kind`, (2) Traceloop `traceloop.span.kind`, (3) OTel GenAI `gen_ai.operation.name` (added to `attributes/genai.yaml`), (4) presence of a model / token usage ⇒ `llm`. When none match, the collector leaves the new `kind` ClickHouse column empty and `api` omits the JSON key (`omitempty`); consumers then infer the role from span context. Stored as a `kind LowCardinality(String) DEFAULT ''` column; pre-migration rows read back as `''` and are likewise omitted.

  > Unlike `source` (v4) and `agent_name` — internal query dimensions kept out of the public shape — `kind` **is** added to the public `span.json` / OpenAPI `Span`, because the dashboard renders it directly (span tag + timeline colour) instead of re-deriving the role on every load. `internal` is deliberately **not** a wire value: the collector never emits it; it is only the dashboard's local fallback bucket for unclassified structural spans.
- `GET /v1/metrics/error-series` — failed-vs-total run counts per time bucket across the range, powering the dashboard's "Failures by day" horizon strip. Returns `PaginatedErrorBucketResponse` of `ErrorBucket` (`bucket_ms`, `errors`, `total`). Additive, backward-compatible, no `schema_version` bump — runs are bucketed by start time and counted as errored if any span carries an error type, matching `GET /v1/metrics/failures`.
- `agent_name` column on the `tracium.spans` storage table (type: `string`, default `''`) — additive, backward-compatible, no `schema_version` bump. Identifies the agent that owns a span's trace, so the dashboard can group traces per agent instead of by the root span's raw operation name. The collector derives it with the first non-empty of: (1) the resource attribute `service.name` — the deployed application emitting the spans, the most stable identity; (2) `gen_ai.agent.name` — the OTel GenAI agent name set by agent frameworks; (3) `traceloop.workflow.name` then `traceloop.entity.name` — Traceloop decorator names; (4) the span `name` as a last resort. `api` groups the top-agents, failures, and error-series metrics by `agent_name`, falling back to the span `name` for pre-migration rows that read back as `''`.

> Like `source` (v4), `agent_name` is an internal storage/query dimension and is **not** added to the public `span.json` shape — API response shapes are unchanged (the `name`/`agent` JSON keys keep their meaning, only the grouped value improves). Without this fix, every auto-instrumented trace whose root span is a generic operation (e.g. `openai.chat`) collapses into one bucket.

---

## [v4] — Metrics Ingestion (Unified Spans Source)

### Added
- `source` column on the `tracium.spans` storage table (type: `string`, default `'span'`) — additive, backward-compatible, no `schema_version` bump. Discriminates how a row entered Tracium: `'span'` for a real per-call span (the only kind before v4; existing rows read back as the default) or `'metric'` for an aggregate row synthesised by the collector from an OTLP token-usage metric.
- The collector now accepts OTLP **metrics** in addition to traces. It reads OpenLLMetry's `gen_ai.client.token.usage` instrument (`attributes/genai.yaml`), prices each data point with the same pricing table as spans, and writes the result as `source='metric'` rows into the same `tracium.spans` table — so the dashboard reads a single store regardless of ingestion source.
- Aggregation semantics (internal to `api`, no API response-shape change): trace-shaped metrics (runs, latency, error rate, top-agents, failures) are computed from `source='span'` rows only; **cost and token totals prefer `source='metric'` rows when present in the window** (sampling-robust) and fall back to `source='span'` otherwise.

> `source` is an internal storage/query discriminator and is **not** added to the public `span.json` shape — API response shapes are unchanged. A deployment that ingests no metrics has only `source='span'` rows and behaves exactly as before this change.

---

## [v1] — Baseline Schema

### Added
- Initial span schema (v1) with core fields: `trace_id`, `span_id`, `parent_span_id`, `name`, timestamps (`start_time_ms`, `end_time_ms`, `duration_ms`), `model`, `finish_reason`, `input_tokens`, `output_tokens`, `cost_usd`, `tenant_id`, `model_normalized`, `schema_version`
- Initial trace schema with fields: `trace_id`, `name`, timestamps, `tenant_id`, `span_count`, `has_error`, `total_cost_usd`, `schema_version`
- Initial `error.json` schema for the `ErrorResponse` envelope
- Pricing table (`pricing.json`) with models: `gpt-4o`, `gpt-4o-mini`, `claude-sonnet-4-6`, `claude-haiku-4-5`
- OpenAPI spec v0.1.0 with endpoints: `GET /v1/traces`, `GET /v1/traces/{id}`, `GET /v1/health`, `GET /v1/ready`
- OTel GenAI SIG attribute definitions (`attributes/genai.yaml`)
- Tracium-specific attribute definitions (`attributes/tracium.yaml`)
- Codegen scripts: `gen-ts-types.sh`, `gen-go-models.sh`

---

## [v3] — Span Content & Tools

### Added
- `input` field on Span (type: `string`) — additive, optional. Captured prompt/input content. Persisted by the collector only when `capture_content` is enabled (default off), since it may contain sensitive data.
- `output` field on Span (type: `string`) — additive, optional. Captured completion/output content. Same `capture_content` gate as `input`.
- `available_tools` field on Span (type: `array` of `{name, description, used}`) — additive, optional. Tools offered to the model on the span and whether each was used. Sourced from the collector-computed `tracium.available_tools` attribute; captured regardless of `capture_content` (tool metadata, not raw content).
- Documented the content/tool source attributes (`attributes/genai.yaml`): current OTel `gen_ai.input.messages` / `gen_ai.output.messages` / `gen_ai.system_instructions` AND OpenLLMetry's legacy indexed `gen_ai.prompt.{i}.content` / `gen_ai.completion.{i}.content` and `llm.request.functions.{i}.*`. The collector reads both shapes for out-of-the-box compatibility.
- `tracium.available_tools` (`attributes/tracium.yaml`) — collector-computed from `llm.request.functions.*` plus tool-call signals, consistent with the `tracium.*` "computed by the collector" rule.

> All three fields are optional. Consumers reading spans with `schema_version < 3` should treat them as absent. Additive, backward-compatible — no breaking change. Raw content capture is opt-in (collector `capture_content`, default off), matching OTel's `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` default.

---

## [v2] — Error Fields

### Added
- `error_type` field on Span (type: `string`) — additive, backward-compatible, no `schema_version` bump required for readers; written by collector when a span records an error
- `error_message` field on Span (type: `string`) — additive, backward-compatible; human-readable error detail accompanying `error_type`

> Both fields are optional. Consumers reading spans with `schema_version: 1` should treat these fields as absent.

---

## Overview Metrics Endpoints

### Added
- `GET /v1/metrics/kpis` — overview KPIs (cost, runs, p95 latency, error rate) with period-over-period deltas (`KpiSet`)
- `GET /v1/metrics/cost-series` — total cost per time bucket (`CostBucket`)
- `GET /v1/metrics/latency-series` — p50/p95/p99 latency per time bucket (`LatencyBucket`)
- `GET /v1/metrics/top-agents` — highest-spending agents with health status (`AgentCost`)
- `GET /v1/metrics/failures` — agents with the most errored runs (`Failure`)
- Shared `range` (`24h` | `7d` | `30d`) and optional `tenant_id` query parameters

> Additive, read-only aggregations over existing spans. No `schema_version` bump.

# Tracium

**Open-source LLM observability.** Tracium is an OpenTelemetry-native backend for
LLM apps: point any OTel-instrumented app at it and get accurate cost, token,
latency, and error analytics per model, agent, and end-client — built to stay
fast from the first span to hundreds of millions.

It doesn't wrap the OTel SDK, it *is* an OTel backend: any app already exporting
OTLP can send to Tracium with no code changes.

- **License:** Apache 2.0. Enterprise features (SSO, RBAC, PII redaction, budget
  controls) ship separately under a commercial license — never in this repo.
- **Self-hostable:** one `docker compose up` brings up the whole stack.

## Quickstart

Requires Docker with Compose v2.

```bash
git clone https://github.com/tracium/tracium
cd tracium
cp .env.example .env
# Set JWT_SECRET (the API won't start without it) and change the DB passwords:
#   openssl rand -hex 32
docker compose up --build
```

Everything builds from source — no published images required. Schema migrations
run automatically before the app services start.

| Service | URL / port | Purpose |
|---|---|---|
| Dashboard | http://localhost:3000 | Trace viewer + overview UI |
| API | http://localhost:8090 | REST API (`/v1/...`) the dashboard reads |
| Collector — OTLP gRPC | `localhost:4317` | Point your app's OTLP exporter here |
| Collector — OTLP HTTP | `localhost:4318` | Same, HTTP/protobuf |
| Collector — health | http://localhost:8080/health | Liveness / readiness |

Send spans by setting `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in your
app. Runnable Python senders are in [`examples/`](examples/).

> The OTLP ports are **unauthenticated by default** — keep them on a trusted
> network. See [securing the collector](deploy/docs/collector-auth.md).

## Architecture

```
your app ──OTLP──▶ collector ──▶ ClickHouse ◀── api ◀──REST── dashboard
(gRPC/HTTP)      (enrich: cost,    (spans +      (bounded          (trace viewer)
                  tenant, model)    rollups)      reads)
                                   Postgres ◀── api (users, auth, config)
```

The collector is a generic OpenTelemetry Collector distribution plus two Tracium
components; all domain logic sits behind an `enrich.Enricher` seam, so OSS and
Enterprise differ by exactly one processor module. **Storage split:** ClickHouse
holds span/trace data (time-partitioned, daily rollup so query cost tracks the
window, not total rows); Postgres holds config and accounts.

| Directory | Language | Responsibility |
|---|---|---|
| [`collector/`](collector/) | Go | Receive OTLP, enrich, write to ClickHouse — see [ARCHITECTURE.md](collector/ARCHITECTURE.md) |
| [`api/`](api/) | Go | Serve trace/metric data to the dashboard (REST) |
| [`dashboard/`](dashboard/) | React + TS | Trace viewer UI |
| [`spec/`](spec/) | JSON/YAML | Source of truth for API contracts + schemas |
| [`deploy/`](deploy/) | YAML/Helm | Helm chart, migration runner, infra config |

Each directory has its own `README.md` with the details.

## Configuration

- **`JWT_SECRET` is required** — it signs and verifies auth tokens with one key, so
  generate a unique one per deployment (`openssl rand -hex 32`).
- **Retention:** `RETENTION_DAYS` (default 90; `0` keeps data forever).
- **Cost allocation:** any custom OTLP attribute your apps attach (e.g. `team`,
  `user.id`, `environment`) is retained and becomes a dimension you can allocate
  spend by — `GET /v1/metrics/usage-by-attribute?key=team`, or the dashboard's
  cost-allocation picker.
- **Prompt/completion capture is ON by default** (`capture_content: true`) so the
  viewer can show inputs/outputs — set it off if you don't want that text stored;
  PII redaction is an Enterprise feature.

## Kubernetes

Helm chart in [`deploy/helm/tracium`](deploy/helm/tracium/); steps in
[`deploy/README.md`](deploy/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

Apache 2.0 — see [LICENSE](LICENSE).

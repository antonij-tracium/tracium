# Securing the collector's OTLP ports

**The collector's OTLP ports (`4317` gRPC, `4318` HTTP) are unauthenticated by
default.** Anyone who can reach them can send spans. There is no built-in
per-client identity or rate limiting on ingest. This page covers how to keep a
random sender from spamming your Tracium.

## Default posture: keep them internal

The simplest and most common protection is network isolation — treat the
collector as an internal service and never expose the OTLP ports to the public
internet. The Helm chart already assumes this: the collector is a ClusterIP
service and the ingress only routes the API (`/v1`) and dashboard (`/`), never
`4317/4318`. Only workloads inside the cluster can reach it.

In Docker Compose the ports *are* published to the host (`4317:4317`,
`4318:4318`) for local convenience. If that host is internet-facing, either drop
the `ports:` mappings (so only other compose services reach the collector) or add
a token (below).

## Option A — shared bearer token (built in, opt-in)

The `bearertokenauth` extension is compiled into the collector. To require a
single shared token on ingest, edit `config/collector.yaml`:

1. Uncomment the `bearertokenauth` block under `extensions:`.
2. Uncomment the `auth: { authenticator: bearertokenauth }` line under **both**
   the gRPC and HTTP receiver protocols.
3. Add `bearertokenauth` to `service.extensions`.
4. Set `INGEST_TOKEN` in the environment (generate one with
   `openssl rand -hex 32`).

All four spots are tagged `# [ingest-auth]` in the file. Senders then set:

```bash
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <token>"
```

This is one secret shared by every sender. It stops anonymous spam; it does not
distinguish or rotate per client.

## Option B — mTLS

In a service mesh (Istio, Linkerd) mTLS is transparent and is usually the right
answer. Standalone, configure the receiver's TLS with a `client_ca_file` so the
collector rejects any client without a certificate from your CA. See the
upstream [OTLP receiver TLS
docs](https://github.com/open-telemetry/opentelemetry-collector/tree/main/receiver/otlpreceiver).

## Option C — per-client identity (gateway or OIDC)

For rotatable, revocable, per-tenant keys — the SaaS-vendor model — put an
authenticating gateway in front of the collector that maps an API-key header to a
tenant, or use the `oidcauth` extension to validate real JWTs against your IdP.
Per-tenant ingest keys are a Tracium Enterprise feature; the OSS collector ships
the shared-token and mTLS paths above.

## Rate limiting

Auth is not rate limiting. A valid but noisy sender can still flood ingest. Cap
request rate at the ingress or gateway (nginx `limit_req`, Envoy rate limits),
and keep the `memory_limiter` processor in the pipeline to protect the collector
itself from OOM under load.

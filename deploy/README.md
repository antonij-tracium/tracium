# deploy/

Infrastructure for running Tracium: the Helm chart, the schema-migration runner,
and default service configs. **The Docker Compose quickstart lives at the repo
root** (`docker compose up --build` — see the top-level [README](../README.md));
this directory is the Kubernetes/production side plus the shared pieces both use.

```
deploy/
  helm/tracium/     Helm chart (StatefulSets, PVCs, ConfigMaps, Ingress)
  docker/migrate/   migration-runner image (also used by the root compose)
  config/           default collector.yaml / api.yaml
  scripts/          wait-for-db (rollup repair is now the repair-rollup command in the API image)
  docs/             collector-auth, rollup-repair runbooks
```

## Kubernetes (Helm)

Create the secrets the chart references, then install:

```bash
kubectl create secret generic tracium-clickhouse-secret --from-literal=password=$(openssl rand -hex 16)
kubectl create secret generic tracium-postgres-secret   --from-literal=password=$(openssl rand -hex 16)
kubectl create secret generic tracium-api-jwt           --from-literal=jwt-secret=$(openssl rand -hex 32)
helm install tracium ./helm/tracium
```

Every tunable is documented in [`helm/tracium/values.yaml`](helm/tracium/values.yaml).
Ingress exposes the API and dashboard. OTLP and database services stay internal.

Browser login limits use the original client IP. Compose trusts only the
`dashboard` service's resolved addresses; Helm uses a dedicated headless
dashboard Service to discover proxy pod addresses. The API refreshes these
addresses every five seconds on demand and ignores forwarded headers from
other peers. Keep service discovery under deployment control.

When enabling Helm ingress, also set `ingress.trustedProxies` to the ingress
controller's actual peer IPs/CIDRs, or `dns:` followed by a headless Service
name that resolves to its pods. The chart refuses an ingress configuration
without this list. The controller must sanitize `X-Forwarded-For`; do not
trust the entire pod network. Standalone API deployments can use the same
IP/CIDR/`dns:service-name` entries in `AUTH_TRUSTED_PROXIES`.

Existing installations: follow [the workspace upgrade guide](docs/upgrading.md).

## Notes

- **Pricing & schema** are the source-of-truth files in `spec/` and
  `collector/schema/`. The Helm chart needs its own copies under
  `helm/tracium/files/`; regenerate them with **`make sync-generated`** from the
  repo root after any change (don't hand-edit the copies).
- **OTLP ingest requires a per-workspace API key** — [securing the collector](docs/collector-auth.md).
- **Runbook:** [repairing the daily rollup](docs/rollup-repair.md).

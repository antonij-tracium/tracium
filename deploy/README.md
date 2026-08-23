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
  scripts/          wait-for-db, run-migrations
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
Only the collector OTLP ports, the API, and the dashboard are exposed via ingress;
databases never are.

## Notes

- **Pricing & schema** are the source-of-truth files in `spec/` and
  `collector/schema/`. The Helm chart needs its own copies under
  `helm/tracium/files/`; regenerate them with **`make sync-generated`** from the
  repo root after any change (don't hand-edit the copies).
- **OTLP is unauthenticated by default** — [securing the collector](docs/collector-auth.md).
- **Runbook:** [repairing the daily rollup](docs/rollup-repair.md).

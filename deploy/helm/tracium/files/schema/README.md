# Bundled ClickHouse schema

These `*.sql` and `*.sh` files are the canonical migrations, copied from
`collector/schema/`. The chart renders them into a ConfigMap
(`templates/migrate-configmap.yaml`) that the migration Job mounts at
`/migrations`.

When you add or change a migration in `collector/schema/`, copy the
file here so a `helm install`/`helm upgrade` applies it:

    cp collector/schema/*.sql deploy/helm/tracium/files/schema/

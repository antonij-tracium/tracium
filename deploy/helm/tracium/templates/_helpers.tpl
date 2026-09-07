{{/*
Expand the name of the chart.
*/}}
{{- define "tracium.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a fully qualified name using the release name.
*/}}
{{- define "tracium.fullname" -}}
{{- printf "%s" .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Resolve the image tag, in precedence order:
  1. per-component image.tag (an explicit pin for one service), then
  2. global.imageTag (an explicit pin for every service), then
  3. the chart's appVersion — the release's own version, which `helm package
     --app-version` stamps on every published chart. This is the default so a
     released chart automatically requests the images built for that release,
     instead of a value hardcoded in values.yaml that never tracks the tag.
Usage: {{ include "tracium.imageTag" (dict "component" .Values.collector "global" .Values.global "chart" .Chart) }}
*/}}
{{- define "tracium.imageTag" -}}
{{- if .component.image.tag -}}
{{- .component.image.tag -}}
{{- else if .global.imageTag -}}
{{- .global.imageTag -}}
{{- else -}}
{{- .chart.AppVersion -}}
{{- end -}}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "tracium.labels" -}}
app.kubernetes.io/name: {{ include "tracium.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{/*
Selector labels for a named component (e.g. "collector", "api", "dashboard").
Usage: {{ include "tracium.selectorLabels" (dict "Release" .Release "component" "collector") }}
*/}}
{{- define "tracium.selectorLabels" -}}
app.kubernetes.io/name: {{ .component }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Database DSNs. The password is NOT baked in here: it is referenced as a
Kubernetes $(VAR) expansion of an env var that each workload sources from the
ClickHouse/Postgres password Secret. That keeps the password in exactly one
Secret (no separately-managed, easily-forgotten "-db" DSN secret) while still
handing the apps the single CLICKHOUSE_DSN / POSTGRES_DSN they expect.

Any container using these MUST define CLICKHOUSE_PASSWORD / POSTGRES_PASSWORD
(from the respective Secret) BEFORE the DSN env var, since Kubernetes only
expands $(VAR) against env vars declared earlier in the same container.
*/}}
{{- define "tracium.clickhouseDSN" -}}
clickhouse://default:$(CLICKHOUSE_PASSWORD)@{{ include "tracium.fullname" . }}-clickhouse:9000/tracium
{{- end }}
{{- define "tracium.postgresDSN" -}}
postgres://tracium:$(POSTGRES_PASSWORD)@{{ include "tracium.fullname" . }}-postgres:5432/tracium?sslmode=disable
{{- end }}

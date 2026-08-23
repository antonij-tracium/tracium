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
Resolve the image tag: prefer per-component tag, fall back to global.imageTag.
Usage: {{ include "tracium.imageTag" (dict "component" .Values.collector "global" .Values.global) }}
*/}}
{{- define "tracium.imageTag" -}}
{{- if .component.image.tag -}}
{{- .component.image.tag -}}
{{- else -}}
{{- .global.imageTag -}}
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

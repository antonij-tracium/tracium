#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
report_dir="${SELF_HOSTED_REVIEW_DIR:-$PWD/deploy/reports/self-hosted-2026-09-07}"
mkdir -p "$report_dir"
export GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local
export GOCACHE="${GOCACHE:-/tmp/tracium-security-go-cache}"
python3 - "$PWD" "$report_dir" <<'PY'
import hashlib,json,re,sys
from pathlib import Path
root=Path(sys.argv[1]);report=Path(sys.argv[2])
sources={name:(root/name).read_text() for name in (
 'api/internal/query/metrics.go','api/internal/query/rollup.go',
 'api/internal/query/filters.go','collector/schema/003_create_metrics_daily_mv.sql',
 'deploy/helm/tracium/values.yaml','deploy/helm/tracium/templates/_helpers.tpl',
 'deploy/helm/tracium/templates/api-deployment.yaml','.github/workflows/release.yml',
 'api/cmd/api/main.go','api/internal/config/config.go')}
tag=re.search(r'^  imageTag: "([^"]+)"',sources['deploy/helm/tracium/values.yaml'],re.M).group(1)
release=sources['.github/workflows/release.yml']
api=sources['deploy/helm/tracium/templates/api-deployment.yaml']
mv=sources['collector/schema/003_create_metrics_daily_mv.sql']
observations={
 'method':'Static checks of current source/config; not a live Helm install or ClickHouse execution',
 'chart_default_image_tag':tag,
 'release_publishes_git_ref_name':'${{ github.ref_name }}' in release,
 'release_also_publishes_latest':':latest' in release,
 'example_git_tag':'v0.1.0',
 'example_release_image_tags':['v0.1.0','latest'],
 'chart_tag_resolver_uses_app_version':'.Chart.AppVersion' in sources['deploy/helm/tracium/templates/_helpers.tpl'].split('define "tracium.imageTag"',1)[1].split('Common labels',1)[0],
 'api_config_file_mounted':'mountPath: /etc/tracium/api.yaml' in api,
 'api_config_file_env_set':'name: CONFIG_FILE' in api,
 'api_entrypoint_reads_only_explicit_config_path':'configPath := os.Getenv("CONFIG_FILE")' in sources['api/cmd/api/main.go'],
 'raw_cost_reconciles_span_and_metric_sources':"greatest(sumIf(cost_usd, source = 'span'), sumIf(cost_usd, source = 'metric'))" in sources['api/internal/query/metrics.go'],
 'daily_view_selects_only_spans':"WHERE source = 'span'" in mv,
 'long_range_cost_reads_rollup_sum':'SELECT sum(cost)' in sources['api/internal/query/rollup.go'],
 'query_timeout_references':[str(path.relative_to(root)) for path in (root/'api').rglob('*.go') if 'QueryTimeout' in path.read_text()],
}
(report/'static-checks.json').write_text(json.dumps(observations,indent=2)+'\n')
(report/'source-sha256.json').write_text(json.dumps({name:hashlib.sha256(text.encode()).hexdigest() for name,text in sources.items()},indent=2)+'\n')
(report/'overlay.json').write_text(json.dumps({'Replace':{
 str(root/'api/internal/query/self_hosted_review_test.go'):str(root/'deploy/tests/self-hosted-review/query.go.txt')
}},indent=2))
PY
go test -p 2 -overlay "$report_dir/overlay.json" ./api/internal/query -count=1 \
  -run 'TestSelfHostedReviewNoQueryDeadline|TestUseRollup|TestTraceDetailsRequireWorkspaceScope' -v \
  > "$report_dir/query-probes.txt" 2>&1
cat "$report_dir/static-checks.json" "$report_dir/query-probes.txt"

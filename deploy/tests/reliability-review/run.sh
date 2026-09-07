#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
report_dir="${RELIABILITY_REPORT_DIR:-$PWD/deploy/reports/reliability-2026-09-07}"
mkdir -p "$report_dir"
python3 - "$PWD" "$report_dir" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]);report=Path(sys.argv[2])
schemas=['001_create_spans.sql','002_create_metrics_daily.sql','003_create_metrics_daily_mv.sql']
sql='CREATE DATABASE IF NOT EXISTS tracium;\n'+ '\n'.join((root/'collector/schema'/name).read_text() for name in schemas)
sql+='\n'+(root/'deploy/tests/reliability-review/replay.sql').read_text()
(report/'replay-input.sql').write_text(sql)
(report/'overlay.json').write_text(json.dumps({'Replace':{
 str(root/'collector/processor/traciumprocessor/reliability_review_test.go'):str(root/'deploy/tests/reliability-review/pricing.go.txt')
}},indent=2))
PY
docker run --rm --pull=never --network none --memory=512m --cpus=1 \
  --mount "type=bind,source=$report_dir/replay-input.sql,target=/review.sql,readonly" \
  --entrypoint clickhouse clickhouse/clickhouse-server:24.6 \
  local --path /tmp/tracium-review --max_threads 1 --multiquery --queries-file /review.sql \
  > "$report_dir/replay-output.jsonl" 2> "$report_dir/replay-stderr.txt"
GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local GOCACHE=/tmp/tracium-security-go-cache \
  go test -p 2 -overlay "$report_dir/overlay.json" ./collector/processor/traciumprocessor \
  -count=1 -run TestReliabilityReview -v > "$report_dir/pricing-probes.txt" 2>&1
cat "$report_dir/replay-output.jsonl" "$report_dir/pricing-probes.txt"
RELIABILITY_REPORT_DIR="$report_dir" python3 deploy/tests/reliability-review/repair-race.py

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
review_dir="${SECURITY_REPORT_DIR:-$PWD/deploy/reports/security-2026-09-07}"
mkdir -p "$review_dir"
export GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local
export GOCACHE="${GOCACHE:-/tmp/tracium-security-go-cache}"
python3 - "$PWD" "$review_dir/overlay.json" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1])
targets={
    'api/internal/middleware/security_review_test.go':'ratelimit.go.txt',
    'api/internal/handler/security_review_test.go':'membership.go.txt',
    'collector/processor/traciumprocessor/security_review_test.go':'metrics.go.txt',
    'collector/internal/user/security_review_test.go':'cache.go.txt',
}
Path(sys.argv[2]).write_text(json.dumps({'Replace':{
    str(root/target):str(root/'deploy/tests/security'/fixture)
    for target,fixture in targets.items()
}},indent=2))
PY
go test -p 2 -overlay "$review_dir/overlay.json" -count=1 -run TestSecurityReview -v \
  ./api/internal/middleware ./api/internal/handler ./collector/processor/traciumprocessor ./collector/internal/user \
  > "$review_dir/go-probes.txt" 2>&1
node deploy/tests/security/url-token.cjs > "$review_dir/url-token.json"
cat "$review_dir/go-probes.txt" "$review_dir/url-token.json"

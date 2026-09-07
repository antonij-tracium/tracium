#!/usr/bin/env bash
# Restore into new empty volumes; original test volumes remain untouched.
set -euo pipefail
compose=("$@")
ch() { "${compose[@]}" exec -T clickhouse sh -c 'clickhouse-client --password "$CLICKHOUSE_PASSWORD" --query "$1"' sh "$1"; }
"${compose[@]}" stop collector api
before=$(ch "SELECT count(),uniqExact(trace_id),sum(input_tokens) FROM tracium.spans")
rollup_before=$(ch 'SELECT sum(span_count),sum(input_tokens) FROM tracium.metrics_daily')
"${compose[@]}" exec -T postgres pg_dump -U tracium -d tracium -Fc > "$CHECK_DIR/postgres.dump"
"${compose[@]}" stop clickhouse postgres
"${compose[@]}" logs --no-color --tail=150 > "$CHECK_REPORT_DIR/compose-before-restore.log" 2>&1

docker run --rm --network none --memory=128m --cpus=1 \
  -v "${CHECK_PROJECT}_clickhouse_data:/data:ro" -v "$CHECK_DIR:/backup" \
  alpine:latest tar czf /backup/clickhouse.tgz -C /data .
cat > "$CHECK_DIR/restore.yaml" <<'YAML'
services:
  clickhouse:
    volumes: !override ["restored_clickhouse:/var/lib/clickhouse"]
  postgres:
    volumes: !override ["restored_postgres:/var/lib/postgresql/data"]
volumes:
  restored_clickhouse: {}
  restored_postgres: {}
YAML
restore=("${compose[@]}" -f "$CHECK_DIR/restore.yaml")
docker volume create "${CHECK_PROJECT}_restored_clickhouse" >/dev/null
docker run --rm --network none --memory=128m --cpus=1 \
  -v "${CHECK_PROJECT}_restored_clickhouse:/data" -v "$CHECK_DIR:/backup:ro" \
  alpine:latest tar xzf /backup/clickhouse.tgz -C /data
cleanup_restore() {
  code=$?
  "${restore[@]}" logs --no-color --tail=150 > "$CHECK_REPORT_DIR/compose-after-restore.log" 2>&1 || true
  "${restore[@]}" down --volumes --remove-orphans >/dev/null || true
  exit "$code"
}
trap cleanup_restore EXIT
"${restore[@]}" up -d --no-deps clickhouse postgres
for attempt in $(seq 1 60); do
  if "${restore[@]}" exec -T postgres pg_isready -U tracium >/dev/null 2>&1; then break; fi
  sleep 1
done
"${restore[@]}" exec -T postgres pg_restore -U tracium -d tracium --exit-on-error < "$CHECK_DIR/postgres.dump"
for attempt in $(seq 1 60); do
  if after=$(ch 'SELECT count(),uniqExact(trace_id),sum(input_tokens) FROM tracium.spans' 2>/dev/null); then break; fi
  sleep 1
done
rollup_after=$(ch 'SELECT sum(span_count),sum(input_tokens) FROM tracium.metrics_daily')
"${restore[@]}" up -d --no-deps api dashboard
export BACKUP_BEFORE="$before" BACKUP_AFTER="$after" ROLLUP_BEFORE="$rollup_before" ROLLUP_AFTER="$rollup_after"
python3 - <<'PY'
import json,os,time,urllib.request
from pathlib import Path
account=json.loads((Path(os.environ['CHECK_DIR'])/'account.json').read_text())
base=os.environ['API_URL']
login=False;listed=False
for _ in range(60):
 try:
  req=urllib.request.Request(base+'/v1/auth/login',json.dumps({'email':account['email'],'password':account['password']}).encode(),{'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=5) as r: token=json.load(r)['token'];login=True
  req=urllib.request.Request(base+'/v1/workspaces',headers={'Authorization':'Bearer '+token})
  with urllib.request.urlopen(req,timeout=5) as r: response=json.load(r)
  items=response.get('items',[]) if isinstance(response,dict) else response
  listed=any(w['id']==account['workspace'] for w in items)
  break
 except Exception:time.sleep(1)
result={'check':'backup_restore_to_empty_volumes','passed':os.environ['BACKUP_BEFORE']==os.environ['BACKUP_AFTER'] and os.environ['ROLLUP_BEFORE']==os.environ['ROLLUP_AFTER'] and login and listed,
 'before_raw_count_unique_tokens':os.environ['BACKUP_BEFORE'],'after_raw_count_unique_tokens':os.environ['BACKUP_AFTER'],
 'before_rollup_spans_tokens':os.environ['ROLLUP_BEFORE'],'after_rollup_spans_tokens':os.environ['ROLLUP_AFTER'],
 'login_restored':login,'workspace_membership_restored':listed,'method':'Stopped ClickHouse volume archive and Postgres pg_dump/pg_restore; new empty volumes'}
(Path(os.environ['CHECK_REPORT_DIR'])/'backup.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
PY

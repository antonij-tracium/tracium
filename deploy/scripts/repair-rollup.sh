#!/bin/bash
# Rebuild tracium.metrics_daily for specific days from the raw spans.
#
# WHY THIS EXISTS
# metrics_daily is filled by metrics_daily_mv, an INSERT trigger. Materialized
# views do not retract on DELETE, so whatever a bad span contributed to the
# rollup stays there after the span is removed from tracium.spans. Short windows
# (<=30d) read raw spans and look healed; the 90d/1y windows read the rollup and
# stay wrong forever, with no visible cause. Remediation must clean BOTH tables:
# delete the span, then run this.
#
# WHAT IT DOES, PER DAY
#   1. ALTER TABLE ... DELETE WHERE bucket_date = <day>   (synchronous mutation)
#   2. INSERT the same aggregation the MV performs, over that day's spans only.
# Delete-then-insert makes it idempotent: re-running a day converges on the same
# rows. Nothing outside the requested days is touched.
#
# COST. Bounded by the days you ask for, never by the table size: the spans read
# is a half-open start_time_ms range, which prunes on the (start_time_ms,
# trace_id) sort key. There is deliberately no "rebuild everything" mode — at the
# 100M+ span bar that is unrunnable. metrics_daily's own partitions are MONTHLY
# (toYYYYMM), so DROP PARTITION is not used: it would discard whole months,
# including days whose raw spans have already aged out under the spans TTL and
# which therefore could not be rebuilt. Per-day DELETE is the narrow tool.
#
# ORDERING HAZARD. Rebuilding a day while spans are still arriving for it
# double-counts: the MV inserts a partial for the new span and this rebuild also
# reads it. The script refuses a day that is not yet closed, or that has received
# a span within QUIESCE_SECONDS. Late spans arriving AFTER a rebuild are fine —
# the MV adds them on top, exactly as it would have.
#
# DRIFT. Migrations use CREATE TABLE IF NOT EXISTS, so a deployed table can
# differ from the schema files. Every run first checks the live metrics_daily
# layout and the live MV's SELECT against what this script mirrors (collector
# migrations 002/003) and aborts on any mismatch, rather than writing aggregates
# that disagree with the trigger. If you change 002/003, change MV_SELECT and
# EXPECTED_COLUMNS below to match.
#
# Usage:
#   ./repair-rollup.sh --from 2026-07-14 [--to 2026-07-16] [options]
#
#   --from DATE      first bucket_date to rebuild (YYYY-MM-DD, required)
#   --to DATE        last bucket_date to rebuild, inclusive (default: --from)
#   --dry-run        print the SQL and the current numbers, change nothing
#   --allow-empty    rebuild days that have no spans left (they become empty in
#                    the rollup — normal only if the spans aged out under TTL and
#                    you accept losing that day's history)
#   --force          skip the quiescence guard (only when ingestion is stopped)
#   --yes            do not prompt for confirmation
#
# Environment: CLICKHOUSE_HTTP, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD,
#              CLICKHOUSE_DB, QUIESCE_SECONDS
set -euo pipefail

CLICKHOUSE_HTTP="${CLICKHOUSE_HTTP:-http://localhost:8123}"
CLICKHOUSE_USER="${CLICKHOUSE_USER:-default}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-changeme}"
DB="${CLICKHOUSE_DB:-tracium}"
QUIESCE_SECONDS="${QUIESCE_SECONDS:-300}"

FROM=""
TO=""
DRY_RUN=0
ALLOW_EMPTY=0
FORCE=0
ASSUME_YES=0

# Print the "# Usage:" block from this file's header: every comment line from
# there until the first line that is not a comment. Anchoring on the end of the
# comment block rather than on its last line's text keeps this correct when the
# header is edited.
usage() {
  awk '/^# Usage:/ { inblock = 1 }
       inblock && !/^#/ { exit }
       inblock { print substr($0, 3) }' "$0"
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --from)        FROM="${2:-}"; shift 2 ;;
    --to)          TO="${2:-}"; shift 2 ;;
    --dry-run)     DRY_RUN=1; shift ;;
    --allow-empty) ALLOW_EMPTY=1; shift ;;
    --force)       FORCE=1; shift ;;
    --yes)         ASSUME_YES=1; shift ;;
    -h|--help)     usage 0 ;;
    *)             echo "✘ unknown argument: $1" >&2; usage 1 ;;
  esac
done

[ -n "${FROM}" ] || { echo "✘ --from is required" >&2; usage 1; }
TO="${TO:-${FROM}}"
for d in "${FROM}" "${TO}"; do
  printf '%s' "${d}" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' ||
    { echo "✘ dates must be YYYY-MM-DD (got '${d}')" >&2; exit 1; }
done

die() { echo "✘ $1" >&2; exit 1; }

# ch <sql> [url-params] — run a statement, print its output, abort on any error.
ch() {
  local response code
  response=$(curl -sS -w $'\n%{http_code}' \
    -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
    "${CLICKHOUSE_HTTP}/?${2:-}" --data-binary "$1") || die "ClickHouse unreachable at ${CLICKHOUSE_HTTP}"
  code="${response##*$'\n'}"
  [ "${code}" = "200" ] || die "ClickHouse rejected the statement (HTTP ${code}):
${response%$'\n'*}"
  printf '%s' "${response%$'\n'*}"
}

# The aggregation metrics_daily_mv performs, mirrored verbatim from the
# collector's 003_create_metrics_daily_mv.sql. Checked against the live view
# below, so the two cannot silently diverge. source='span' matters: metric-
# derived rows carry no trace identity and the MV excludes them.
MV_SELECT="SELECT
    toDate(start_time_ms / 1000)                       AS bucket_date,
    tenant_id,
    agent_name,
    if(model_normalized != '', model_normalized, model) AS model,
    sum(cost_usd)                                      AS cost,
    sum(input_tokens)                                  AS input_tokens,
    sum(output_tokens)                                 AS output_tokens,
    count()                                            AS span_count,
    uniqState(trace_id)                                AS runs,
    uniqIfState(trace_id, error_type != '' OR error_message != '') AS error_runs
FROM ${DB}.spans
WHERE source = 'span'
GROUP BY bucket_date, tenant_id, agent_name, model"

EXPECTED_COLUMNS="bucket_date	Date
tenant_id	String
agent_name	LowCardinality(String)
model	LowCardinality(String)
cost	SimpleAggregateFunction(sum, Float64)
input_tokens	SimpleAggregateFunction(sum, UInt64)
output_tokens	SimpleAggregateFunction(sum, UInt64)
span_count	SimpleAggregateFunction(sum, UInt64)
runs	AggregateFunction(uniq, String)
error_runs	AggregateFunction(uniqIf, String, UInt8)"

squash() { tr -d '[:space:]'; }  # compare SQL/type text without formatting noise

# --- Preflight: the deployed objects must match what this script mirrors ------
echo "▶ Checking deployed schema (${DB} at ${CLICKHOUSE_HTTP})..."

layout=$(ch "SELECT engine, sorting_key FROM system.tables
             WHERE database='${DB}' AND name='metrics_daily' FORMAT TSV")
[ -n "${layout}" ] || die "${DB}.metrics_daily does not exist — run the migrations first."
[ "$(printf '%s' "${layout}" | squash)" = \
  "$(printf 'AggregatingMergeTree\tbucket_date, tenant_id, agent_name, model' | squash)" ] ||
  die "${DB}.metrics_daily has drifted from migration 002 (engine/sort key: ${layout}).
   Refusing to write aggregates into a table this script does not understand."

columns=$(ch "SELECT name, type FROM system.columns
              WHERE database='${DB}' AND table='metrics_daily' ORDER BY position FORMAT TSV")
[ "$(printf '%s' "${columns}" | squash)" = "$(printf '%s' "${EXPECTED_COLUMNS}" | squash)" ] ||
  die "${DB}.metrics_daily columns have drifted from migration 002.
   The rebuild INSERT is positional, so writing now would corrupt the rollup.
   deployed:
${columns}
   expected:
${EXPECTED_COLUMNS}"

deployed_select=$(ch "SELECT as_select FROM system.tables
                      WHERE database='${DB}' AND name='metrics_daily_mv' FORMAT TSVRaw")
[ -n "${deployed_select}" ] || die "${DB}.metrics_daily_mv does not exist (or exposes no as_select)."
# Both sides go through the server's own formatter, so this compares meaning,
# not layout: the live trigger and this script must aggregate identically.
normalized_mine=$(ch "EXPLAIN SYNTAX ${MV_SELECT} FORMAT TSVRaw" | squash)
normalized_live=$(ch "EXPLAIN SYNTAX ${deployed_select} FORMAT TSVRaw" | squash)
[ "${normalized_mine}" = "${normalized_live}" ] ||
  die "${DB}.metrics_daily_mv aggregates differently from this script.
   Rebuilding would produce numbers the trigger would not have produced.
   live view:
${deployed_select}"
echo "  metrics_daily and metrics_daily_mv match migrations 002/003."

# --- Days to rebuild ----------------------------------------------------------
span_days=$(ch "SELECT dateDiff('day', toDate('${FROM}'), toDate('${TO}')) FORMAT TSV")
[ "${span_days}" -ge 0 ] || die "--to (${TO}) is before --from (${FROM})."
days=$(ch "SELECT toString(toDate('${FROM}') + number)
           FROM numbers(${span_days} + 1) FORMAT TSV")

echo "▶ Rebuilding $((span_days + 1)) day(s): ${FROM} .. ${TO}"
if [ "${DRY_RUN}" = "0" ] && [ "${ASSUME_YES}" = "0" ]; then
  [ -t 0 ] || die "not a terminal — pass --yes to confirm non-interactively."
  read -r -p "  Delete and rebuild these rollup days? [y/N] " reply
  case "${reply}" in y|Y|yes|YES) ;; *) echo "  aborted."; exit 1 ;; esac
fi

for day in ${days}; do
  echo "▶ ${day}"

  # Half-open millisecond range for the day. Unqualified toDateTime uses the
  # server timezone, the same one toDate(start_time_ms/1000) uses in the MV, so
  # the range and the MV's bucket agree by construction — and the guard below
  # proves it on this deployment rather than assuming it.
  from_ms="toInt64(toUnixTimestamp(toDateTime('${day} 00:00:00'))) * 1000"
  to_ms="toInt64(toUnixTimestamp(toDateTime('${day} 00:00:00') + INTERVAL 1 DAY)) * 1000"
  in_day="source = 'span' AND start_time_ms >= ${from_ms} AND start_time_ms < ${to_ms}"

  stats=$(ch "SELECT count(), countDistinct(toDate(start_time_ms / 1000)),
                     min(toDate(start_time_ms / 1000)), max(toDate(start_time_ms / 1000)),
                     sum(cost_usd), toInt64(dateDiff('second', max(received_at), now()))
              FROM ${DB}.spans WHERE ${in_day} FORMAT TSV")
  IFS=$'\t' read -r raw_spans distinct_days min_day max_day raw_cost age <<<"${stats}"

  if [ "${raw_spans}" != "0" ]; then
    # The time range must land in exactly the bucket the MV would have written.
    { [ "${distinct_days}" = "1" ] && [ "${min_day}" = "${day}" ] && [ "${max_day}" = "${day}" ]; } ||
      die "time range for ${day} covers bucket_date ${min_day}..${max_day} —
   the server timezone does not agree with the MV's bucketing. Aborting."
    if [ "${age}" -lt "${QUIESCE_SECONDS}" ] && [ "${FORCE}" = "0" ]; then
      die "spans for ${day} were received ${age}s ago (< QUIESCE_SECONDS=${QUIESCE_SECONDS}).
   Rebuilding a day that is still receiving spans double-counts them.
   Wait until the day is closed, stop ingestion, or pass --force."
    fi
  elif [ "${ALLOW_EMPTY}" = "0" ]; then
    echo "  ⚠ no spans remain for ${day} (aged out under the spans TTL?)."
    echo "    Rebuilding would empty this day in the rollup, which keeps history"
    echo "    far longer than spans do. Skipping — pass --allow-empty to proceed."
    continue
  fi

  rollup_before=$(ch "SELECT sum(cost), sum(span_count) FROM ${DB}.metrics_daily
                      WHERE bucket_date = toDate('${day}') FORMAT TSV")
  printf '  rollup now: %s\n  raw spans:  %s\t%s\n' \
    "${rollup_before}" "${raw_cost:-0}" "${raw_spans}"

  delete_sql="ALTER TABLE ${DB}.metrics_daily DELETE WHERE bucket_date = toDate('${day}')"

  # Bind the MV's SELECT to this one day by rewriting its WHERE clause. If that
  # pattern ever stops matching (MV_SELECT reformatted to track a schema change),
  # the INSERT would silently fall back to the *unbounded* SELECT and fold the
  # entire spans table into this single day — both wrong and unrunnable at the
  # 100M+ span bar. Verify the bound is present rather than trusting the rewrite.
  day_select="${MV_SELECT/WHERE source = \'span\'/WHERE ${in_day}}"
  case "${day_select}" in
    *"${in_day}"*) ;;
    *) die "internal error: could not scope the rebuild to ${day}.
   MV_SELECT no longer contains the literal \"WHERE source = 'span'\" that this
   script rewrites, so the INSERT would have been unbounded. Refusing to run." ;;
  esac
  insert_sql="INSERT INTO ${DB}.metrics_daily
${day_select}"

  if [ "${DRY_RUN}" = "1" ]; then
    printf '  -- dry run, nothing written --\n%s;\n%s;\n' "${delete_sql}" "${insert_sql}"
    continue
  fi

  # mutations_sync=2 waits for the delete to finish on all replicas, so the
  # insert can never race the mutation that is clearing the same rows.
  ch "${delete_sql}" "mutations_sync=2" >/dev/null
  ch "${insert_sql}" >/dev/null
  echo "  rebuilt:    $(ch "SELECT sum(cost), sum(span_count) FROM ${DB}.metrics_daily
                            WHERE bucket_date = toDate('${day}') FORMAT TSV")"
done

if [ "${DRY_RUN}" = "1" ]; then
  echo "✔ Dry run complete — no changes made."
else
  echo "✔ Rollup repair complete."
  echo "  Long-range dashboard windows (>30d) read this table; short windows read"
  echo "  raw spans. Both should now agree for the repaired days."
fi

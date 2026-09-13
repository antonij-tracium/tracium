// Shared presentation helpers for anomalies (outliers): severity/metric visual
// meta, value formatting, the summary chip tallies, and alignment of an
// anomaly's bucket_ms onto a chart's bucket index so it can be flagged in place.

import { fmtCost, fmtNum, fmtPct } from '../../../common';
import type { ChartMarker } from '../../../common/interfaces';
import type { Anomaly, AnomalyMetric, AnomalyScope, AnomalySeverity } from '../interfaces';

// Severity → colour tokens. color-mix keeps the tint/border derived from one
// token, matching how Badge / StatusPill build their surfaces (no hardcoded rgba).
export const SEVERITY_META: Record<AnomalySeverity, { color: string; tint: string; border: string; rank: number }> = {
  critical: { color: 'var(--error)', tint: 'color-mix(in srgb, var(--error) 14%, transparent)', border: 'color-mix(in srgb, var(--error) 42%, transparent)', rank: 3 },
  warning: { color: 'var(--warning)', tint: 'color-mix(in srgb, var(--warning) 14%, transparent)', border: 'color-mix(in srgb, var(--warning) 42%, transparent)', rank: 2 },
  // info uses a neutral tone, not the brand accent — an outlier is never "good",
  // and a green flag on a spike would read that way.
  info: { color: 'var(--muted-foreground)', tint: 'color-mix(in srgb, var(--muted-foreground) 16%, transparent)', border: 'color-mix(in srgb, var(--muted-foreground) 42%, transparent)', rank: 1 },
};

// Metric → the noun used in copy and the short "kind" tag shown on rows/points.
export const METRIC_META: Record<AnomalyMetric, { noun: string; kind: string }> = {
  cost: { noun: 'Cost', kind: 'Cost' },
  error_rate: { noun: 'Error rate', kind: 'Errors' },
  runs: { noun: 'Run volume', kind: 'Volume' },
};

// anomalyValue formats a metric value in its own units (USD, percent, count).
export function anomalyValue(metric: AnomalyMetric, v: number): string {
  switch (metric) {
    case 'cost':
      return fmtCost(v);
    case 'error_rate':
      return fmtPct(v * 100);
    default:
      return fmtNum(Math.round(v));
  }
}

// zLabel renders a signed robust z-score as e.g. "3.8σ".
export function zLabel(score: number): string {
  return `${Math.abs(score).toFixed(1)}σ`;
}

// anomalyKey is a stable identity for one anomaly (the model carries no id),
// used for selection and session-local dismissal.
export function anomalyKey(a: Anomaly): string {
  return `${a.metric}:${a.scope}:${a.workflow}:${a.bucket_ms}`;
}

export interface AnomalyChip {
  key: string;
  label: string;
  count: number;
  color: string;
  tint: string;
  border: string;
}

// anomalyChips tallies the outliers by kind for the summary strip. Cost and
// error counts carry the error tint, volume the warning tint — a coarse signal
// that mirrors which metrics are usually incidents. Zero-count kinds are dropped.
export function anomalyChips(anomalies: Anomaly[]): AnomalyChip[] {
  const count = (m: AnomalyMetric) => anomalies.filter((a) => a.metric === m).length;
  const defs: { key: string; metric: AnomalyMetric; word: (n: number) => string; sev: AnomalySeverity }[] = [
    { key: 'cost', metric: 'cost', word: (n) => `${n} cost spike${n === 1 ? '' : 's'}`, sev: 'critical' },
    { key: 'errors', metric: 'error_rate', word: (n) => `${n} error spike${n === 1 ? '' : 's'}`, sev: 'critical' },
    { key: 'runs', metric: 'runs', word: (n) => `${n} volume shift${n === 1 ? '' : 's'}`, sev: 'warning' },
  ];
  return defs
    .map((d) => {
      const n = count(d.metric);
      const m = SEVERITY_META[d.sev];
      return { key: d.key, label: d.word(n), count: n, color: m.color, tint: m.tint, border: m.border };
    })
    .filter((c) => c.count > 0);
}

// bySeverity sorts anomalies most-actionable first (severity, then |score|, then
// most recent) — the same order the API returns, re-applied after client filters.
export function bySeverity(a: Anomaly, b: Anomaly): number {
  const s = SEVERITY_META[b.severity].rank - SEVERITY_META[a.severity].rank;
  if (s !== 0) return s;
  const z = Math.abs(b.score) - Math.abs(a.score);
  if (z !== 0) return z;
  return b.bucket_ms - a.bucket_ms;
}

// ratioLabel renders how many times the baseline the observed value is, e.g.
// "4.6×". Returned only when a clean multiple exists (positive baseline and a
// same-signed observed); otherwise empty, so callers can fall back to the signed
// deviation. Small ratios keep one decimal, large ones drop it.
export function ratioLabel(observed: number, expected: number): string {
  if (expected <= 0 || observed <= 0) return '';
  const r = observed / expected;
  if (!Number.isFinite(r) || r <= 0) return '';
  return `${r >= 10 ? Math.round(r) : r.toFixed(1)}×`;
}

// An incident groups every anomaly that fired for the same target on the same
// day — one workflow's bad day usually trips cost, errors and volume at once, and a
// reviewer wants to judge that as a single event rather than three scattered
// flags. `severity` is the worst in the group; `anomalies` is pre-sorted
// most-actionable first.
export interface Incident {
  key: string;
  scope: AnomalyScope;
  workflow: string; // '' for workspace-wide
  bucket_ms: number;
  severity: AnomalySeverity;
  anomalies: Anomaly[];
}

// groupIncidents clusters anomalies by (scope, workflow, day) and orders the
// incidents the same way rows are ordered: worst severity, then largest |score|,
// then most recent. Within an incident the anomalies are sorted bySeverity.
export function groupIncidents(anomalies: Anomaly[]): Incident[] {
  const byKey = new Map<string, Incident>();
  for (const a of anomalies) {
    const key = `${a.scope}:${a.workflow}:${a.bucket_ms}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.anomalies.push(a);
      if (SEVERITY_META[a.severity].rank > SEVERITY_META[existing.severity].rank) {
        existing.severity = a.severity;
      }
    } else {
      byKey.set(key, {
        key,
        scope: a.scope,
        workflow: a.workflow,
        bucket_ms: a.bucket_ms,
        severity: a.severity,
        anomalies: [a],
      });
    }
  }
  const incidents = [...byKey.values()];
  for (const inc of incidents) inc.anomalies.sort(bySeverity);
  incidents.sort((x, y) => {
    // Compare on each incident's most-actionable anomaly (its first, after the
    // per-incident sort above) so incident order matches the flat list order.
    const s = SEVERITY_META[y.severity].rank - SEVERITY_META[x.severity].rank;
    if (s !== 0) return s;
    const z = Math.abs(y.anomalies[0].score) - Math.abs(x.anomalies[0].score);
    if (z !== 0) return z;
    return y.bucket_ms - x.bucket_ms;
  });
  return incidents;
}

// toChartMarkers aligns already-metric-filtered anomalies onto a chart's buckets
// by matching bucket_ms, colouring each by severity. It keeps the chart legible
// when many buckets flag: at most one marker per bucket (the most severe), and no
// more than `max` markers overall (the most severe) — the full counts still live
// in the chips and the panel. Anomalies whose bucket is outside the chart window
// (e.g. baseline-only days) are dropped. onSelect makes each flag clickable.
export function toChartMarkers(
  anomalies: Anomaly[],
  bucketMs: number[],
  opts?: { label?: (a: Anomaly) => string; onSelect?: (a: Anomaly) => void; max?: number },
): ChartMarker[] {
  const indexOf = new Map(bucketMs.map((ms, i) => [ms, i]));
  const max = opts?.max ?? 4;
  const seen = new Set<number>();
  const markers: ChartMarker[] = [];
  // Most severe first, so the one kept per bucket (and the ones kept under the
  // cap) are the ones worth showing.
  for (const a of [...anomalies].sort(bySeverity)) {
    const index = indexOf.get(a.bucket_ms);
    if (index === undefined || seen.has(index)) continue;
    seen.add(index);
    markers.push({
      index,
      color: SEVERITY_META[a.severity].color,
      label: opts?.label?.(a),
      onClick: opts?.onSelect ? () => opts.onSelect!(a) : undefined,
    });
    if (markers.length >= max) break;
  }
  return markers;
}

// Deterministic, demo-only series for the workflow detail page. There is no live
// per-workflow timeseries endpoint yet, so these derive stable charts from the
// workflow's own headline numbers (calls / cost / latency / error rate). The PRNG
// is seeded from the workflow name so a given workflow always renders identically.
//
// Note: no anomaly injection and no health-driven spikes. The charts show the
// workflow's ordinary day-to-day variation only.

import type { CostPoint, LatencyPoint, ErrorPoint } from '../../../common/interfaces';
import type { Workflow, WorkflowRun } from '../interfaces';

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Linear congruential generator → a stable stream of [0,1) from a seed.
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Bucket labels per range, matching the demo overview's convention: hourly for
// 24h, weekdays for 7d, day-of-month for 30d. Ranges without a demo shape
// (90d/1y) fall back to the 7d buckets, same as the demo overview.
function bucketLabels(range: string): string[] {
  if (range === '24h') return Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
  if (range === '30d') return Array.from({ length: 30 }, (_, i) => `${i + 1}`);
  return DAYS;
}

/** Per-bucket spend over the window, summing roughly to the workflow's window cost. */
export function buildCostSeries(a: Workflow, range = '7d'): CostPoint[] {
  const labels = bucketLabels(range);
  const r = rng(hash(a.name) + 3);
  const avg = a.cost / labels.length;
  return labels.map((label) => ({
    label,
    value: Math.max(0.0004, avg * (0.6 + r() * 0.9)),
  }));
}

/** p50 / p95 / p99 latency (seconds) per bucket over the window. */
export function buildLatencySeries(a: Workflow, range = '7d'): LatencyPoint[] {
  const r = rng(hash(a.name) + 7);
  const base = a.avg_latency_ms / 1000;
  return bucketLabels(range).map((label) => ({
    label,
    p50: base * (0.7 + r() * 0.2),
    p95: base * (1.6 + r() * 0.5),
    p99: base * (2.6 + r() * 0.8),
  }));
}

/** Failed vs total runs per bucket over the window. */
export function buildErrorSeries(a: Workflow, range = '7d'): ErrorPoint[] {
  const labels = bucketLabels(range);
  const r = rng(hash(a.name) + 13);
  const perBucket = Math.round(a.calls / labels.length);
  return labels.map((label) => {
    const total = Math.max(1, Math.round(perBucket * (0.7 + r() * 0.6)));
    const rate = a.error_rate * (0.5 + r() * 1.2);
    return { label, errors: Math.min(total, Math.round(total * rate)), total };
  });
}

const RUN_TIMES = [
  'just now', '12s ago', '48s ago', '2m ago', '5m ago',
  '9m ago', '14m ago', '22m ago', '31m ago', '47m ago',
];
const RUN_ERRORS = [
  'rate_limit_exceeded', 'context_length_exceeded', 'tool_timeout', 'validation_softfail',
];

/** The workflow's most recent runs, oldest-to-newest left in source order. */
export function buildRuns(a: Workflow): WorkflowRun[] {
  const r = rng(hash(a.name) + 101);
  const hex = (s: string) => (hash(s) & 0xffff).toString(16).padStart(4, '0');
  return RUN_TIMES.map((time, i) => {
    const failed = r() < a.error_rate * 4 + 0.015;
    const lat = a.avg_latency_ms * (0.6 + r() * 1.1) * (failed ? 1.4 : 1);
    return {
      id: `t_${hex(`${a.name}_${i}`)}_${hex(`${a.name}#${i}z`)}`,
      status: failed ? 'failed' : 'completed',
      time,
      duration: lat,
      cost: (a.cost / a.calls) * (0.5 + r() * 1.1),
      tokens: Math.round(600 + r() * 4200),
      err: failed ? RUN_ERRORS[Math.floor(r() * RUN_ERRORS.length)] : null,
    };
  });
}

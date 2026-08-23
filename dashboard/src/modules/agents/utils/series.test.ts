import { describe, it, expect } from 'vitest';
import { buildCostSeries, buildLatencySeries, buildErrorSeries, buildRuns } from './series';
import type { Agent } from '../interfaces';

const AGENT: Agent = {
  name: 'rewrite-message',
  calls: 156,
  cost: 0.3104,
  avg_latency_ms: 4800,
  error_rate: 0.083,
  trend: [],
  last_trace_id: 't_demo',
};

describe('agent detail series', () => {
  it('is deterministic per agent (same name → same series)', () => {
    expect(buildCostSeries(AGENT)).toEqual(buildCostSeries(AGENT));
    expect(buildLatencySeries(AGENT)).toEqual(buildLatencySeries(AGENT));
    expect(buildErrorSeries(AGENT)).toEqual(buildErrorSeries(AGENT));
    expect(buildRuns(AGENT)).toEqual(buildRuns(AGENT));
  });

  it('produces a 7-day cost series with positive values and no anomaly markers', () => {
    const series = buildCostSeries(AGENT);
    expect(series).toHaveLength(7);
    for (const d of series) {
      expect(d.value).toBeGreaterThan(0);
      // The OSS detail page carries no anomaly flag on cost points.
      expect('anomaly' in d).toBe(false);
    }
  });

  it('buckets by the selected range: 24 hourly, 7 daily, 30 daily', () => {
    expect(buildCostSeries(AGENT, '24h')).toHaveLength(24);
    expect(buildCostSeries(AGENT, '24h')[0].label).toBe('00:00');
    expect(buildCostSeries(AGENT, '7d')).toHaveLength(7);
    expect(buildCostSeries(AGENT, '30d')).toHaveLength(30);
    expect(buildLatencySeries(AGENT, '24h')).toHaveLength(24);
    expect(buildErrorSeries(AGENT, '30d')).toHaveLength(30);
  });

  it('keeps latency percentiles ordered p50 ≤ p95 ≤ p99', () => {
    for (const d of buildLatencySeries(AGENT)) {
      expect(d.p50!).toBeLessThanOrEqual(d.p95!);
      expect(d.p95!).toBeLessThanOrEqual(d.p99!);
    }
  });

  it('never reports more errors than total runs in a bucket', () => {
    for (const d of buildErrorSeries(AGENT)) {
      expect(d.errors).toBeLessThanOrEqual(d.total);
      expect(d.errors).toBeGreaterThanOrEqual(0);
    }
  });

  it('builds recent runs whose failed rows carry an error code and ok rows do not', () => {
    const runs = buildRuns(AGENT);
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      if (r.status === 'failed') expect(r.err).not.toBeNull();
      else expect(r.err).toBeNull();
    }
  });
});

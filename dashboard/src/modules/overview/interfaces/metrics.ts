// API response types for the overview metrics endpoints. All values are raw
// numbers; formatting (currency, percent, seconds) happens in the components.

export type DeltaType = 'good' | 'bad' | 'neutral';

export interface Kpi {
  value: number;
  delta: number; // fraction: 0.12 === +12%
  delta_type: DeltaType;
}

export interface KpiSet {
  cost: Kpi; // total cost, USD
  runs: Kpi; // agent runs (distinct traces)
  latency_p95: Kpi; // p95 trace duration, ms
  error_rate: Kpi; // fraction of traces with an error
}

export interface CostBucket {
  bucket_ms: number;
  value: number;
}

export interface LatencyBucket {
  bucket_ms: number;
  // null for buckets with no runs — latency is undefined, not 0 (see LatencyPoint)
  p50: number | null;
  p95: number | null;
  p99: number | null; // all ms
}

export interface ErrorBucket {
  bucket_ms: number;
  errors: number; // runs that errored within the bucket
  total: number; // total runs that started within the bucket
}

export interface AgentCost {
  name: string;
  cost: number;
  calls: number;
  trend: number[]; // call count per time bucket, oldest first — the usage sparkline
}

export interface FailureRow {
  agent: string;
  count: number;
  pct: number; // fraction of that agent's runs that failed
}

// Anomaly is one bucket of one series that deviated significantly from its own
// recent history — the /metrics/anomalies payload. Detection is daily and
// rollup-backed; metric is the series that moved, scope/agent locate it, and
// observed/expected/deviation/score carry the math the UI explains.
export type AnomalyMetric = 'cost' | 'error_rate' | 'runs';
export type AnomalyScope = 'workspace' | 'agent';
export type AnomalyDirection = 'spike' | 'drop';
export type AnomalySeverity = 'info' | 'warning' | 'critical';

export interface Anomaly {
  metric: AnomalyMetric;
  scope: AnomalyScope;
  agent: string; // set when scope === 'agent', else ''
  bucket_ms: number; // anomalous day bucket, UTC midnight
  observed: number; // the bucket's value (USD, error rate 0–1, or run count)
  expected: number; // baseline median
  deviation: number; // observed − expected
  score: number; // signed robust z-score
  direction: AnomalyDirection;
  severity: AnomalySeverity;
  summary: string; // ready-to-read description
}

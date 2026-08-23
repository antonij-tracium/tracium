// API response shape for GET /v1/metrics/agents — one active agent over the
// window. avg_latency_ms is mean end-to-end run duration (0 for long windows
// served from the rollup, where per-trace durations aren't retained);
// error_rate is the fraction of the agent's runs that errored (0–1); trend is
// the per-bucket call count, oldest first and zero-filled, for the sparkline.
export interface Agent {
  name: string;
  calls: number;
  cost: number;
  avg_latency_ms: number;
  error_rate: number;
  trend: number[];
  // Most recent trace in the window, for deep-linking a row to its trace detail.
  // Empty for long windows served from the rollup (no trace identity retained).
  last_trace_id: string;
}

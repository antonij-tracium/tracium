// API response shape for GET /v1/metrics/usage-users. cost/runs are the
// current window; *_prev are the equal-length preceding window (for per-column
// change). trend is cost per time bucket across the current window.
export interface UserUsage {
  user_id: string;
  cost: number;
  cost_prev: number;
  runs: number;
  runs_prev: number;
  trend: number[];
}

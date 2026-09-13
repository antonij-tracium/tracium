// API response shape for GET /v1/metrics/usage-workflows. cost/runs are the
// current window; *_prev are the preceding window. model is the workflow's
// most-used model.
export interface WorkflowUsage {
  name: string;
  model: string;
  cost: number;
  cost_prev: number;
  runs: number;
  runs_prev: number;
}

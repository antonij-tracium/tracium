// API response shape for GET /v1/metrics/usage-agents. cost/runs are the
// current window; *_prev are the preceding window. model is the agent's
// most-used model.
export interface AgentUsage {
  name: string;
  model: string;
  cost: number;
  cost_prev: number;
  runs: number;
  runs_prev: number;
}

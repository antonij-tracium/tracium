import type { AgentTool } from './AgentMeta';

// API response shape for GET /v1/metrics/agents/{name} — one agent's detail
// page. Span-backed only: there is no agent-config store, so runtime params
// (temperature, retries, version, owner, …) are not served — the configuration
// panel trims to model/provider/tokens/tools. p95_latency_ms is null when
// undefined (no runs). avg_latency_ms is in milliseconds; error_rate is a
// fraction (0–1). provider is inferred from the model id and may be empty.
export interface AgentDetail {
  name: string;
  calls: number;
  cost: number;
  avg_latency_ms: number;
  p95_latency_ms: number | null;
  error_rate: number;
  input_tokens: number;
  output_tokens: number;
  model: string;
  provider: string;
  tools: AgentTool[];
  last_trace_id: string;
}

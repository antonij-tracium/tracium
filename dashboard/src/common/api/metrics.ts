import { BaseAPIClient } from './client';
import type { PaginatedResponse } from '../interfaces';
import type {
  KpiSet,
  CostBucket,
  LatencyBucket,
  ErrorBucket,
  AgentCost,
  FailureRow,
  Anomaly,
  AnomalyMetric,
  AnomalySeverity,
} from '../../modules/overview/interfaces';
import type {
  ModelCost,
  UserUsage,
  AgentUsage,
  AttributeUsage,
} from '../../modules/usage/interfaces';
import type { Agent, AgentDetail } from '../../modules/agents/interfaces';

// MetricsAPI reads the aggregated overview metrics. Each section is its own
// endpoint so the dashboard can load and refresh them independently.
export class MetricsAPI extends BaseAPIClient {
  getKpis(range: string): Promise<KpiSet> {
    return this.get('/metrics/kpis', { range });
  }

  // The series accept an optional `agent` to scope the chart to one agent (the
  // detail page). Omitted, they return the workspace-wide series as before.
  getCostSeries(range: string, agent?: string): Promise<PaginatedResponse<CostBucket>> {
    return this.get('/metrics/cost-series', { range, agent });
  }

  getLatencySeries(range: string, agent?: string): Promise<PaginatedResponse<LatencyBucket>> {
    return this.get('/metrics/latency-series', { range, agent });
  }

  getErrorSeries(range: string, agent?: string): Promise<PaginatedResponse<ErrorBucket>> {
    return this.get('/metrics/error-series', { range, agent });
  }

  getTopAgents(range: string): Promise<PaginatedResponse<AgentCost>> {
    return this.get('/metrics/top-agents', { range });
  }

  getAgents(range: string): Promise<PaginatedResponse<Agent>> {
    return this.get('/metrics/agents', { range });
  }

  // One agent's detail payload. Raw-window only (≤30d): the server rejects
  // longer ranges, since per-agent latency isn't in the daily rollup.
  getAgentDetail(name: string, range: string): Promise<AgentDetail> {
    return this.get(`/metrics/agents/${encodeURIComponent(name)}`, { range });
  }

  getFailures(range: string): Promise<PaginatedResponse<FailureRow>> {
    return this.get('/metrics/failures', { range });
  }

  // Statistical anomalies (cost / error-rate / run-volume) over the window,
  // workspace-wide and per busy agent. Daily and rollup-backed, so the server
  // requires a range of 7d or longer (24h is rejected). Optional metric and
  // min_severity narrow the results.
  getAnomalies(
    range: string,
    opts?: { metric?: AnomalyMetric; min_severity?: AnomalySeverity },
  ): Promise<PaginatedResponse<Anomaly>> {
    return this.get('/metrics/anomalies', { range, metric: opts?.metric, min_severity: opts?.min_severity });
  }

  // Usage-page breakdowns. cost-series / kpis feed the rest of the page.
  getModelCosts(range: string): Promise<PaginatedResponse<ModelCost>> {
    return this.get('/metrics/model-costs', { range });
  }

  getUserUsage(range: string, userId?: string): Promise<PaginatedResponse<UserUsage>> {
    return this.get('/metrics/usage-users', { range, user_id: userId });
  }

  getAgentUsage(range: string): Promise<PaginatedResponse<AgentUsage>> {
    return this.get('/metrics/usage-agents', { range });
  }

  // Custom-attribute allocation. attribute-keys lists the dimensions present in
  // the window (team, user.id, environment, …); usage-by-attribute groups spend
  // across the values of the chosen key.
  getAttributeKeys(range: string): Promise<PaginatedResponse<string>> {
    return this.get('/metrics/attribute-keys', { range });
  }

  getUsageByAttribute(range: string, key: string): Promise<PaginatedResponse<AttributeUsage>> {
    return this.get('/metrics/usage-by-attribute', { range, key });
  }
}

import { BaseAPIClient } from './client';
import type { PaginatedResponse } from '../interfaces';
import type {
  KpiSet,
  CostBucket,
  LatencyBucket,
  ErrorBucket,
  AgentCost,
  FailureRow,
} from '../../modules/overview/interfaces';
import type {
  ModelCost,
  TenantUsage,
  AgentUsage,
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

  // Usage-page breakdowns. cost-series / kpis feed the rest of the page.
  getModelCosts(range: string): Promise<PaginatedResponse<ModelCost>> {
    return this.get('/metrics/model-costs', { range });
  }

  getTenantUsage(range: string): Promise<PaginatedResponse<TenantUsage>> {
    return this.get('/metrics/usage-tenants', { range });
  }

  getAgentUsage(range: string): Promise<PaginatedResponse<AgentUsage>> {
    return this.get('/metrics/usage-agents', { range });
  }
}

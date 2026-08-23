import type { DailySeriesPoint } from './DailySeriesPoint';
import type { TenantSummary } from './TenantSummary';
import type { AgentSummary } from './AgentSummary';
import type { ModelSummary } from './ModelSummary';

export interface UsageData {
  range: {
    label: string;
    start: string;
    end: string;
    days: number;
  };
  totalCost: number;
  totalCostPrev: number;
  totalRuns: number;
  totalRunsPrev: number;
  dailySeries: DailySeriesPoint[];
  tenants: TenantSummary[];
  agents: AgentSummary[];
  models: ModelSummary[];
}

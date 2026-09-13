import type { DailySeriesPoint } from './DailySeriesPoint';
import type { UserSummary } from './UserSummary';
import type { WorkflowSummary } from './WorkflowSummary';
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
  users: UserSummary[];
  workflows: WorkflowSummary[];
  models: ModelSummary[];
}

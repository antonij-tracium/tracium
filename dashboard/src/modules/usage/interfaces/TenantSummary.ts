import type { TenantId } from '../../../common/ids';

export interface TenantSummary {
  id: TenantId;
  name: string;
  cost: number;
  costPrev: number;
  runs: number;
  runsPrev: number;
  avg: number;
  trend: number[];
  // Billing tier — present in demo data, absent for live telemetry-derived rows.
  plan?: string;
}

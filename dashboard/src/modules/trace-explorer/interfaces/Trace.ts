import type { TraceId } from '../ids';
import type { TenantId } from '../../../common/ids';

export interface Trace {
  trace_id: TraceId;
  name: string;
  start_time_ms: number;
  end_time_ms: number;
  duration_ms: number;
  tenant_id: TenantId;
  span_count: number;
  has_error: boolean;
  total_cost_usd: number;
}

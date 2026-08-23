import type { TenantId } from '../../../common/ids';

export interface TraceFilter {
  tenant_id?: TenantId;
  model?: string;
  /** Restrict to one agent (the trace root name) — powers an agent's recent runs. */
  agent?: string;
  /** Time window token (24h/7d/30d/90d/1y); bounds the listing server-side. */
  range?: string;
  has_error?: boolean;
  start_after?: string;
  start_before?: string;
  page?: number;
  page_size?: number;
}

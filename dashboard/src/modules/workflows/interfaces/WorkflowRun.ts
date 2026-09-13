// A single recent run of an workflow, shown in the detail page's "Recent runs"
// table. Run-level completed/failed is the trace outcome, not an workflow-health
// signal — it stays in the OSS dashboard.

export interface WorkflowRun {
  id: string;
  status: 'completed' | 'failed';
  /** Human-relative start time, e.g. "2m ago". */
  time: string;
  /** End-to-end duration in milliseconds. */
  duration: number;
  cost: number;
  /** Total tokens for the run, or null when unavailable (the trace list carries no token totals). */
  tokens: number | null;
  /** Error code when the run failed, otherwise null. */
  err: string | null;
}

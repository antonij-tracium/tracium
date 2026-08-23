// Derive completed/failed run counts for the stats strip. The agents endpoints
// report `calls` and `error_rate` (a fraction the server computed as
// failed/calls over the window), so rounding the product recovers the failed
// count without a second query.

export interface RunOutcomes {
  completed: number;
  failed: number;
}

export function deriveRunOutcomes(calls: number, errorRate: number): RunOutcomes {
  const failed = Math.min(calls, Math.max(0, Math.round(calls * errorRate)));
  return { completed: calls - failed, failed };
}

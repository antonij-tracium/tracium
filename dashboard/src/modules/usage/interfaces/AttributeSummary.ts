// A row in the "Who's driving cost" breakdown when allocating spend by a custom
// OpenTelemetry attribute (team, user.id, environment, …). Same shape the user
// and agent tabs render, so the shared Breakdown table can display it unchanged.
// The attribute endpoint carries no previous-period figures, so the *Prev fields
// are 0 (deltas read flat).
export interface AttributeSummary {
  name: string;
  cost: number;
  costPrev: number;
  runs: number;
  runsPrev: number;
  avg: number;
}

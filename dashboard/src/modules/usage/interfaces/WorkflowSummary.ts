export interface WorkflowSummary {
  name: string;
  cost: number;
  costPrev: number;
  runs: number;
  runsPrev: number;
  avg: number;
  model: string;
}

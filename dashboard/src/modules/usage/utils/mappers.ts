import type { Kpi, CostBucket, ErrorBucket } from '../../overview/interfaces';
import type { DeltaTone } from '../components';
import type {
  DailySeriesPoint,
  ModelCost,
  ModelSummary,
  WorkflowUsage,
  WorkflowSummary,
} from '../interfaces';

// Bar colors for the models list, cycled in rank order (highest spend first).
const MODEL_COLORS = ['var(--accent)', '#7aa5ff', '#c08aff', '#f5a524', '#6366f1', '#34d399'];

function bucketLabel(ms: number, range: string): string {
  const d = new Date(ms);
  if (range === '24h') return `${String(d.getHours()).padStart(2, '0')}:00`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// Split a Kpi into the strip's display delta + tone. Neutral (no baseline) shows
// no delta chip, matching OverviewLivePage's deltaParts.
export function deltaParts(k: Kpi): { delta: string; deltaTone: DeltaTone } {
  if (k.delta_type === 'neutral') return { delta: '', deltaTone: 'neutral' };
  const pct = Math.round(Math.abs(k.delta) * 1000) / 10;
  return { delta: `${k.delta >= 0 ? '+' : '-'}${pct}%`, deltaTone: k.delta_type };
}

// Zip cost-per-bucket with runs-per-bucket (ErrorBucket.total) by index — both
// series share the same gap-free bucket axis, so positions line up.
export function toDailySeries(cost: CostBucket[], errors: ErrorBucket[], range: string): DailySeriesPoint[] {
  return cost.map((c, i) => ({
    day: i + 1,
    label: bucketLabel(c.bucket_ms, range),
    cost: c.value,
    runs: errors[i]?.total ?? 0,
  }));
}

export const toModelSummaries = (models: ModelCost[]): ModelSummary[] =>
  models.map((m, i) => ({
    name: m.name,
    cost: m.cost,
    runs: m.calls,
    inputTokens: m.input_tokens,
    outputTokens: m.output_tokens,
    color: MODEL_COLORS[i % MODEL_COLORS.length],
  }));

export const toWorkflowSummaries = (workflows: WorkflowUsage[]): WorkflowSummary[] =>
  workflows.map((a) => ({
    name: a.name,
    model: a.model,
    cost: a.cost,
    costPrev: a.cost_prev,
    runs: a.runs,
    runsPrev: a.runs_prev,
    avg: a.runs > 0 ? a.cost / a.runs : 0,
  }));

export const sumCost = (rows: { cost: number }[]): number => rows.reduce((s, r) => s + r.cost, 0);

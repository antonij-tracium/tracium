// ---------------------------------------------------------------------------
// UsageLivePage — the signed-in usage view, fed by the metrics API. Mirrors
// OverviewLivePage: each section loads independently (Section handles its
// spinner / error), and an empty workspace shows the "No usage yet" state. The
// presentational components are shared with the demo UsagePage.
//
// Spend / Runs reuse the overview KPI + series endpoints; the three breakdowns
// (models, tenants, agents) have their own usage endpoints. Per-row change vs
// the previous period comes straight from the *_prev fields the API returns.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { EmptyState, costFormatter, tokenFormatter } from '../../../common';
import type { TenantId } from '../../../common/ids';
import { Section } from '../../overview/components';
import { useKpis, useCostSeries, useErrorSeries } from '../../overview/hooks/useMetrics';
import type { Kpi, KpiSet, CostBucket, ErrorBucket } from '../../overview/interfaces';
import {
  SectionHead,
  KpiStrip,
  DailyChart,
  DailyChartLegend,
  ModelsList,
  Panel,
  PanelFrame,
  UsageMasthead,
  Breakdown,
  TabPill,
  AllocationPanel,
} from '../components';
import type { KpiItem, DeltaTone, BreakdownTab, SortKey } from '../components';
import { useModelCosts, useTenantUsage, useAgentUsage } from '../hooks/useUsage';
import type {
  DailySeriesPoint,
  ModelSummary,
  TenantSummary,
  AgentSummary,
  ModelCost,
  TenantUsage,
  AgentUsage,
} from '../interfaces';

interface UsageLivePageProps {
  range: string;
  setView: (v: string) => void;
  setSelected: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
}

const RANGE_LABEL: Record<string, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '1y': 'Last year',
};

// Bar colors for the models list, cycled in rank order (highest spend first).
const MODEL_COLORS = ['var(--accent)', '#7aa5ff', '#c08aff', '#f5a524', '#6366f1', '#34d399'];

// ── Formatting helpers ──────────────────────────────────────────────────────

function bucketLabel(ms: number, range: string): string {
  const d = new Date(ms);
  if (range === '24h') return `${String(d.getHours()).padStart(2, '0')}:00`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// Split a Kpi into the strip's display delta + tone. Neutral (no baseline) shows
// no delta chip, matching OverviewLivePage's deltaParts.
function deltaParts(k: Kpi): { delta: string; deltaTone: DeltaTone } {
  if (k.delta_type === 'neutral') return { delta: '', deltaTone: 'neutral' };
  const pct = Math.round(Math.abs(k.delta) * 1000) / 10;
  return { delta: `${k.delta >= 0 ? '+' : '-'}${pct}%`, deltaTone: k.delta_type };
}

// tokens is the summed input+output token count for the window, drawn from the
// (separately loaded) model-cost query; undefined until that query resolves.
function toKpiItems(kpis: KpiSet, tokens: number | undefined): KpiItem[] {
  const spend = kpis.cost.value;
  const runs = kpis.runs.value;
  const avgPer1k = runs > 0 ? (spend / runs) * 1000 : 0;
  return [
    {
      label: 'Spend',
      value: costFormatter.format(spend),
      ...deltaParts(kpis.cost),
      hint: 'vs prev period',
    },
    {
      label: 'Runs',
      value: Math.round(runs).toLocaleString(),
      ...deltaParts(kpis.runs),
      hint: costFormatter.format(avgPer1k) + ' / 1K runs',
    },
    {
      label: 'Tokens',
      value: tokens != null ? tokenFormatter.format(tokens) : '—',
      delta: '',
      deltaTone: 'neutral',
      hint: 'input + output',
    },
  ];
}

// Zip cost-per-bucket with runs-per-bucket (ErrorBucket.total) by index — both
// series share the same gap-free bucket axis, so positions line up.
function toDailySeries(cost: CostBucket[], errors: ErrorBucket[], range: string): DailySeriesPoint[] {
  return cost.map((c, i) => ({
    day: i + 1,
    label: bucketLabel(c.bucket_ms, range),
    cost: c.value,
    runs: errors[i]?.total ?? 0,
  }));
}

const toModelSummaries = (models: ModelCost[]): ModelSummary[] =>
  models.map((m, i) => ({
    name: m.name,
    cost: m.cost,
    runs: m.calls,
    inputTokens: m.input_tokens,
    outputTokens: m.output_tokens,
    color: MODEL_COLORS[i % MODEL_COLORS.length],
  }));

const toTenantSummaries = (tenants: TenantUsage[]): TenantSummary[] =>
  tenants.map((t) => ({
    id: (t.tenant_id || '—') as TenantId,
    name: t.tenant_id || 'default',
    cost: t.cost,
    costPrev: t.cost_prev,
    runs: t.runs,
    runsPrev: t.runs_prev,
    avg: t.runs > 0 ? t.cost / t.runs : 0,
    trend: t.trend ?? [],
    // plan is intentionally omitted — it isn't telemetry-derived.
  }));

const toAgentSummaries = (agents: AgentUsage[]): AgentSummary[] =>
  agents.map((a) => ({
    name: a.name,
    model: a.model,
    cost: a.cost,
    costPrev: a.cost_prev,
    runs: a.runs,
    runsPrev: a.runs_prev,
    avg: a.runs > 0 ? a.cost / a.runs : 0,
  }));

const sumCost = (rows: { cost: number }[]): number => rows.reduce((s, r) => s + r.cost, 0);

// ── Page ────────────────────────────────────────────────────────────────────

export function UsageLivePage({ range, setView, setSelected }: UsageLivePageProps) {
  const [tab, setTab] = useState<BreakdownTab>('tenant');
  const [sortBy, setSortBy] = useState<SortKey>('cost');

  const kpis = useKpis(range);
  const cost = useCostSeries(range);
  const errors = useErrorSeries(range);
  const models = useModelCosts(range);
  const tenants = useTenantUsage(range);
  const agents = useAgentUsage(range);

  function handleTabChange(t: BreakdownTab) {
    setTab(t);
    setSortBy('cost');
  }

  // Empty workspace: nothing ingested in the window — no spend and no runs.
  if (kpis.isSuccess && kpis.data.cost.value === 0 && kpis.data.runs.value === 0) {
    return (
      <EmptyState
        message="No usage yet"
        description="Usage and cost metrics appear once data is flowing."
      />
    );
  }

  const dailySeries =
    cost.data && errors.data ? toDailySeries(cost.data.items, errors.data.items, range) : [];
  const modelRows = models.data ? toModelSummaries(models.data.items) : [];
  const totalTokens = models.data
    ? modelRows.reduce((s, m) => s + m.inputTokens + m.outputTokens, 0)
    : undefined;
  const tenantRows = tenants.data ? toTenantSummaries(tenants.data.items) : [];
  const agentRows = agents.data ? toAgentSummaries(agents.data.items) : [];

  const tenantCount = tenants.data?.items.length ?? 0;
  const agentCount = agents.data?.items.length ?? 0;
  const subtitle = `${RANGE_LABEL[range] ?? RANGE_LABEL['7d']} · ${tenantCount} active tenants, ${agentCount} agents`;

  // Freshness reflects the most recent successful fetch across the page's
  // sections; 0 (nothing loaded yet) hides the badge.
  const updatedAt =
    Math.max(
      kpis.dataUpdatedAt,
      cost.dataUpdatedAt,
      errors.dataUpdatedAt,
      models.dataUpdatedAt,
      tenants.dataUpdatedAt,
      agents.dataUpdatedAt,
    ) || undefined;

  return (
    <div
      style={{
        padding: 'clamp(20px, 4vw, 32px) clamp(16px, 4vw, 40px) 96px',
        maxWidth: 1480,
        margin: '0 auto',
      }}
    >
      <UsageMasthead subtitle={subtitle} updatedAt={updatedAt} />

      <div style={{ paddingBottom: 8 }}>
        <Section isLoading={kpis.isLoading} isError={kpis.isError} minHeight={90}>
          {kpis.data && <KpiStrip items={toKpiItems(kpis.data, totalTokens)} />}
        </Section>
      </div>

      <div style={{ marginTop: 28 }}>
        <PanelFrame
          left={
            <Panel eyebrow="Spend" title="Daily spend" right={<DailyChartLegend />}>
              <Section
                isLoading={cost.isLoading || errors.isLoading}
                isError={cost.isError || errors.isError}
                minHeight={200}
              >
                <DailyChart series={dailySeries} />
              </Section>
            </Panel>
          }
          right={
            <Panel eyebrow="Models" title="Where it goes">
              <Section isLoading={models.isLoading} isError={models.isError} minHeight={200}>
                <ModelsList models={modelRows} />
              </Section>
            </Panel>
          }
        />
      </div>

      <SectionHead
        title="Who's driving cost"
        hint="Dot marks the top 75% of spend — the rows worth reviewing first."
        right={
          <TabPill
            tab={tab}
            setTab={handleTabChange}
            tabs={[
              { id: 'tenant', label: 'By tenant', count: tenantCount },
              { id: 'agent', label: 'By agent', count: agentCount },
            ]}
          />
        }
      />
      {tab === 'tenant' ? (
        <Section isLoading={tenants.isLoading} isError={tenants.isError}>
          <Breakdown
            rows={tenantRows}
            totalCost={sumCost(tenantRows)}
            kind="tenant"
            sortBy={sortBy}
            setSortBy={setSortBy}
          />
        </Section>
      ) : (
        <Section isLoading={agents.isLoading} isError={agents.isError}>
          <Breakdown
            rows={agentRows}
            totalCost={sumCost(agentRows)}
            kind="agent"
            sortBy={sortBy}
            setSortBy={setSortBy}
          />
        </Section>
      )}

      <AllocationPanel range={range} />
    </div>
  );
}

export default UsageLivePage;

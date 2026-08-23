// ---------------------------------------------------------------------------
// UsagePage — the demo usage view (embedded auth preview), fed by mock
// USAGE_DATA. The signed-in dashboard renders UsageLivePage instead; both share
// the presentational components in ../components.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { costFormatter, tokenFormatter } from '../../../common';
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
} from '../components';
import type { KpiItem, BreakdownTab, SortKey } from '../components';
import { USAGE_DATA } from '../data';

export interface UsagePageProps {
  range: string;
}

function kpiItems(data: typeof USAGE_DATA): KpiItem[] {
  const costDelta = ((data.totalCost - data.totalCostPrev) / data.totalCostPrev) * 100;
  const runsDelta = ((data.totalRuns - data.totalRunsPrev) / data.totalRunsPrev) * 100;
  const avgPer1k = data.totalRuns > 0 ? (data.totalCost / data.totalRuns) * 1000 : 0;
  const totalTokens = data.models.reduce((s, m) => s + m.inputTokens + m.outputTokens, 0);

  return [
    {
      label: 'Spend',
      value: costFormatter.format(data.totalCost),
      delta: (costDelta > 0 ? '+' : '') + costDelta.toFixed(1) + '%',
      deltaTone: costDelta > 0 ? 'bad' : 'good',
      hint: 'vs ' + costFormatter.format(data.totalCostPrev) + ' prev',
    },
    {
      label: 'Runs',
      value: data.totalRuns.toLocaleString(),
      delta: (runsDelta > 0 ? '+' : '') + runsDelta.toFixed(1) + '%',
      deltaTone: 'neutral',
      hint: costFormatter.format(avgPer1k) + ' / 1K runs',
    },
    {
      label: 'Tokens',
      value: tokenFormatter.format(totalTokens),
      delta: '',
      deltaTone: 'neutral',
      hint: 'input + output',
    },
  ];
}

export default function UsagePage({ range: _range }: UsagePageProps) {
  const data = USAGE_DATA;
  const [tab, setTab] = useState<BreakdownTab>('tenant');
  const [sortBy, setSortBy] = useState<SortKey>('cost');
  const items = useMemo(() => kpiItems(data), [data]);

  function handleTabChange(t: BreakdownTab) {
    setTab(t);
    setSortBy('cost');
  }

  return (
    <div
      style={{
        padding: 'clamp(20px, 4vw, 32px) clamp(16px, 4vw, 40px) 96px',
        maxWidth: 1480,
        margin: '0 auto',
      }}
    >
      <UsageMasthead
        subtitle={`${data.range.start} – ${data.range.end} · ${data.tenants.length} active tenants, ${data.agents.length} agents`}
      />

      <div style={{ paddingBottom: 8 }}>
        <KpiStrip items={items} />
      </div>

      <div style={{ marginTop: 28 }}>
        <PanelFrame
          left={
            <Panel eyebrow="Spend" title="Daily spend" right={<DailyChartLegend />}>
              <DailyChart series={data.dailySeries} />
            </Panel>
          }
          right={
            <Panel eyebrow="Models" title="Where it goes">
              <ModelsList models={data.models} />
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
              { id: 'tenant', label: 'By tenant', count: data.tenants.length },
              { id: 'agent', label: 'By agent', count: data.agents.length },
            ]}
          />
        }
      />
      {tab === 'tenant' ? (
        <Breakdown
          rows={data.tenants}
          totalCost={data.totalCost}
          kind="tenant"
          sortBy={sortBy}
          setSortBy={setSortBy}
        />
      ) : (
        <Breakdown
          rows={data.agents}
          totalCost={data.totalCost}
          kind="agent"
          sortBy={sortBy}
          setSortBy={setSortBy}
        />
      )}
    </div>
  );
}

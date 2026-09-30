import { useState } from 'react';
import {
  EmptyState,
  LastUpdated,
  StatusPill,
  costFormatter,
  fmtCost,
  fmtMs,
  fmtNum,
  fmtPct,
  isLongRange,
  relativeTime,
  tokenFormatter,
  useMaxWidth,
  BREAKPOINTS,
} from '../../../common';
import { Section } from '../../overview/components';
import type { KpiSet } from '../../overview/interfaces';
import type { Trace } from '../../trace-explorer/interfaces';
import {
  SectionHead,
  KpiStrip,
  DailyChart,
  DailyChartLegend,
  ModelsList,
  Panel,
  PanelFrame,
  Breakdown,
} from '../components';
import type { KpiItem, SortKey } from '../components';
import {
  useClientKpis,
  useClientCostSeries,
  useClientErrorSeries,
  useClientModelCosts,
  useClientWorkflowUsage,
  useClientTraces,
} from '../hooks/useClientDetail';
import {
  deltaParts,
  periodLabel,
  toDailySeries,
  toModelSummaries,
  toWorkflowSummaries,
  sumCost,
} from '../mappers';
import styles from './UserDetailLivePage.module.css';

interface Props {
  userId: string;
  range: string;
  setView: (view: string) => void;
  setSelected: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
}

function toKpiItems(kpis: KpiSet, tokens: number | undefined, range: string): KpiItem[] {
  const spend = kpis.cost.value;
  const runs = kpis.runs.value;
  const failed = Math.round(runs * kpis.error_rate.value);
  const items: KpiItem[] = [
    {
      label: 'Spend',
      value: costFormatter.format(spend),
      ...deltaParts(kpis.cost),
      hint: 'vs prev period',
    },
    {
      label: 'Runs',
      value: fmtNum(Math.round(runs)),
      ...deltaParts(kpis.runs),
      hint: costFormatter.format(runs > 0 ? (spend / runs) * 1000 : 0) + ' / 1K runs',
    },
    {
      label: 'Failure rate',
      value: fmtPct(kpis.error_rate.value * 100),
      ...deltaParts(kpis.error_rate),
      hint: `${fmtNum(failed)} failed`,
    },
  ];
  if (isLongRange(range)) {
    items.push({
      label: 'Tokens',
      value: tokens != null ? tokenFormatter.format(tokens) : '—',
      delta: '',
      deltaTone: 'neutral',
      hint: 'input + output',
    });
  } else {
    items.push({
      label: 'p95 latency',
      value: fmtMs(kpis.latency_p95.value),
      ...deltaParts(kpis.latency_p95),
      hint: 'end-to-end',
    });
  }
  return items;
}

function TracesTable({ traces, onOpen }: { traces: Trace[]; onOpen: (id: string) => void }) {
  if (traces.length === 0) {
    return <p className={styles.none}>No traces in this period.</p>;
  }
  return (
    <div className={styles.tableScroll}>
      <div className={styles.traceHead}>
        <span>Trace</span>
        <span>Status</span>
        <span>Started</span>
        <span className={styles.right}>Spans</span>
        <span className={styles.right}>Duration</span>
        <span className={styles.right}>Cost</span>
      </div>
      {traces.map((t) => (
        <button key={t.trace_id} className={styles.traceRow} onClick={() => onOpen(t.trace_id)}>
          <span className={styles.traceName}>
            <span className={styles.traceTitle}>{t.name || t.trace_id}</span>
            <span className={styles.traceId}>{t.trace_id}</span>
          </span>
          <span>
            <StatusPill status={t.has_error ? 'failed' : 'completed'} />
          </span>
          <span className={styles.muted}>{relativeTime(t.start_time_ms)}</span>
          <span className={styles.num}>{fmtNum(t.span_count)}</span>
          <span className={styles.num}>{fmtMs(t.duration_ms)}</span>
          <span className={styles.num}>{fmtCost(t.total_cost_usd)}</span>
        </button>
      ))}
    </div>
  );
}

export function UserDetailLivePage({ userId, range, setView, setSelected }: Props) {
  const [sortBy, setSortBy] = useState<SortKey>('cost');
  const stacked = useMaxWidth(BREAKPOINTS.tablet);

  const kpis = useClientKpis(userId, range);
  const cost = useClientCostSeries(userId, range);
  const errors = useClientErrorSeries(userId, range);
  const models = useClientModelCosts(userId, range);
  const workflows = useClientWorkflowUsage(userId, range);
  const traces = useClientTraces(userId, range);

  const openTrace = (id: string) => {
    setSelected((prev) => ({ ...prev, traceId: id }));
    setView('trace');
  };
  const openWorkflow = (name: string) => {
    setSelected((prev) => ({ ...prev, workflow: name }));
    setView('workflows');
  };

  const back = (
    <button className={styles.back} onClick={() => setView('users')}>
      ← All clients
    </button>
  );

  if (!userId) {
    return (
      <div className={styles.page}>
        {back}
        <EmptyState message="No client selected" description="Pick a client from the Clients list." />
      </div>
    );
  }

  const noUsage = kpis.isSuccess && kpis.data.cost.value === 0 && kpis.data.runs.value === 0;

  const modelRows = models.data ? toModelSummaries(models.data.items) : [];
  const totalTokens = models.data
    ? modelRows.reduce((s, m) => s + m.inputTokens + m.outputTokens, 0)
    : undefined;
  const workflowRows = workflows.data ? toWorkflowSummaries(workflows.data.items) : [];
  const dailySeries =
    cost.data && errors.data ? toDailySeries(cost.data.items, errors.data.items, range) : [];
  const lastSeen = traces.data?.items[0]?.start_time_ms;

  const updatedAt =
    Math.max(
      kpis.dataUpdatedAt,
      cost.dataUpdatedAt,
      errors.dataUpdatedAt,
      models.dataUpdatedAt,
      workflows.dataUpdatedAt,
      traces.dataUpdatedAt,
    ) || undefined;

  return (
    <div className={styles.page}>
      {back}

      <header className={styles.masthead}>
        <div className={styles.text}>
          <h1 className={styles.title}>{userId}</h1>
          <p className={styles.subtitle}>
            {periodLabel(range)}
            {lastSeen != null && (
              <>
                <span className={styles.sep}>·</span>
                Last seen <span className={styles.strong}>{relativeTime(lastSeen)}</span>
              </>
            )}
            {workflowRows.length > 0 && (
              <>
                <span className={styles.sep}>·</span>
                {workflowRows.length} {workflowRows.length === 1 ? 'workflow' : 'workflows'}
              </>
            )}
          </p>
        </div>
        {updatedAt != null && <LastUpdated at={updatedAt} />}
      </header>

      <Section isLoading={kpis.isLoading} isError={kpis.isError} minHeight={90}>
        {noUsage ? (
          <EmptyState
            message="No usage found"
            description="This client has no activity in the selected workspace and period."
          />
        ) : (
          kpis.data && (
            <>
              <KpiStrip items={toKpiItems(kpis.data, totalTokens, range)} />

              <div className={styles.panels}>
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
                    <Panel eyebrow="Models" title="Where it goes" scroll={!stacked}>
                      <Section isLoading={models.isLoading} isError={models.isError} minHeight={200}>
                        <ModelsList models={modelRows} />
                      </Section>
                    </Panel>
                  }
                />
              </div>

              <SectionHead
                title="Workflows"
                hint="What this client runs, and what each workflow costs. Select one to open it."
              />
              <Section isLoading={workflows.isLoading} isError={workflows.isError}>
                <Breakdown
                  rows={workflowRows}
                  totalCost={sumCost(workflowRows)}
                  kind="workflow"
                  sortBy={sortBy}
                  setSortBy={setSortBy}
                  onRowClick={(row) => openWorkflow(row.name)}
                />
              </Section>
            </>
          )
        )}
      </Section>

      <SectionHead title="Recent traces" hint="The client's latest runs, newest first." />
      <Section isLoading={traces.isLoading} isError={traces.isError}>
        <TracesTable traces={traces.data?.items ?? []} onOpen={openTrace} />
      </Section>
    </div>
  );
}

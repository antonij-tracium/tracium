// ---------------------------------------------------------------------------
// OverviewLivePage — the signed-in overview, fed by the metrics API. Each
// section loads independently (Section handles its spinner / error); when there
// are no runs at all we show the "no data yet" empty state. The presentational
// components are shared with the demo OverviewPage.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { EmptyState, fmtCost, fmtNum, fmtMs, fmtPct, isLongRange, RANGE_LABEL, toCostPoints, toLatencyPoints, toErrorPoints } from '../../../common';
import type { CostPoint, LatencyPoint, ErrorPoint } from '../../../common/interfaces';
import type { Trace } from '../../trace-explorer/interfaces';
import {
  Masthead,
  KpiStrip,
  ChartsRow,
  FailuresBlock,
  TopAgents,
  ActivityFeed,
  OverviewLayout,
  Section,
  OutlierChips,
  OutliersPanel,
} from '../components';
import type { KpiItem, TopAgentRow, SyncStatus, SyncTone } from '../components';
import {
  useKpis,
  useCostSeries,
  useLatencySeries,
  useErrorSeries,
  useTopAgents,
  useFailures,
  useAnomalies,
  useRecentActivity,
} from '../hooks/useMetrics';
import type { Kpi, KpiSet, AgentCost, FailureRow, ActivityItem, Anomaly } from '../interfaces';
import { anomalyKey, anomalyValue, toChartMarkers } from '../utils/anomalies';
import type { ActivityId } from '../ids';
import type { Tweaks } from './OverviewPage';

interface OverviewLivePageProps {
  range: string;
  setView: (v: string) => void;
  setSelected: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  tweaks: Tweaks;
}


// ── Formatting helpers ──────────────────────────────────────────────────────
// bucketLabel / toCostPoints / toLatencyPoints / toErrorPoints are shared with
// the agent detail charts (common/utils/buckets).

// Split a fractional delta into a signed display value (drives the arrow) and a
// "vs prev" hint, the way the KPI strip expects.
function deltaParts(k: Kpi): { delta: string; hint: string } {
  // Drive "no change" off delta_type, not the fraction: the backend marks a
  // metric neutral exactly when there's nothing to compare — cur == prev, or no
  // data in the previous period — and only those cases carry a zero delta.
  if (k.delta_type === 'neutral') return { delta: '', hint: 'no change' };
  // Sign comes from the raw fraction (so it always matches the arrow tone);
  // magnitude keeps one decimal so a real sub-1% move shows as +0.4%, not 0%.
  const mag = Math.round(Math.abs(k.delta) * 1000) / 10;
  return { delta: `${k.delta > 0 ? '+' : '-'}${mag}%`, hint: 'vs prev period' };
}

function toKpiItems(kpis: KpiSet, cost: CostPoint[], latency: LatencyPoint[], errors: ErrorPoint[], range: string): KpiItem[] {
  // Both span the full window: Traces is a count; failure rate reads 0 in empty
  // buckets, which is truthful — no runs means nothing failed.
  const tracesTrend = errors.map((d) => d.total);
  const failureTrend = errors.map((d) => (d.total > 0 ? d.errors / d.total : 0));
  // Latency comes from raw spans only; long ranges read the daily rollup, which
  // can't reconstruct per-trace durations, so the tile reads "—" rather than 0.
  const latencyAvailable = !isLongRange(range);
  const latencyItem: KpiItem = latencyAvailable
    ? { label: 'p95 latency', value: fmtMs(kpis.latency_p95.value), ...deltaParts(kpis.latency_p95), deltaTone: kpis.latency_p95.delta_type, sparkData: latency.map((d) => d.p95), sparkColor: 'var(--accent)' }
    : { label: 'p95 latency', value: '—', hint: 'not tracked over long ranges' };
  return [
    { label: 'Total spend', value: fmtCost(kpis.cost.value), ...deltaParts(kpis.cost), deltaTone: kpis.cost.delta_type, sparkData: cost.map((d) => d.value) },
    { label: 'Traces', value: fmtNum(Math.round(kpis.runs.value)), ...deltaParts(kpis.runs), deltaTone: kpis.runs.delta_type, sparkData: tracesTrend },
    { label: 'Failure rate', value: fmtPct(kpis.error_rate.value * 100), ...deltaParts(kpis.error_rate), deltaTone: kpis.error_rate.delta_type, sparkData: failureTrend, sparkColor: 'var(--warning)' },
    latencyItem,
  ];
}

const toAgentRows = (agents: AgentCost[]): TopAgentRow[] =>
  agents.map((a) => ({ name: a.name, calls: a.calls, cost: a.cost, trend: a.trend }));

// The failures endpoint reports per-agent rows plus the true total of errored
// runs across all agents; we derive the strip's summary line (total failed,
// worst agent) from them. totalFailed comes from the envelope's total —
// the rows are only the top agents, so re-summing them would undercount once
// more than that many agents have failures. The horizon strip itself is fed by
// the separate error-series endpoint.
function failuresSummary(rows: FailureRow[], total: number): { totalFailed: number; worstAgent: string } {
  const worst = rows.reduce<FailureRow | null>((m, r) => (!m || r.count > m.count ? r : m), null);
  return { totalFailed: total, worstAgent: worst?.agent ?? '—' };
}

// ── Sync status ─────────────────────────────────────────────────────────────
// The masthead chip must reflect reality, not a hardcoded "Synced just now":
// red if any section failed, amber once data has gone stale, green when fresh.
// Metrics sections don't poll, so "synced" is only as true as the stalest one —
// we drive freshness off the oldest successful fetch.
const STALE_AFTER_MS = 5 * 60 * 1000;

function syncedLabel(ageMs: number): string {
  const s = Math.round(ageMs / 1000);
  if (s < 10) return 'Synced just now';
  if (s < 60) return `Synced ${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `Synced ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Synced ${h}h ago`;
  return `Synced ${Math.floor(h / 24)}d ago`;
}

function syncStatus(queries: { isError: boolean; isSuccess: boolean; dataUpdatedAt: number }[]): SyncStatus {
  if (queries.some((q) => q.isError)) return { label: 'Sync failed', tone: 'error' };
  const updates = queries.filter((q) => q.isSuccess).map((q) => q.dataUpdatedAt);
  if (updates.length === 0) return { label: 'Syncing…', tone: 'syncing' };
  const ageMs = Date.now() - Math.min(...updates);
  const tone: SyncTone = ageMs > STALE_AFTER_MS ? 'stale' : 'live';
  return { label: syncedLabel(ageMs), tone };
}

function relTime(startMs: number): string {
  const s = Math.max(0, Math.round((Date.now() - startMs) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const toActivityItems = (traces: Trace[]): ActivityItem[] =>
  traces.map((t) => ({
    id: t.trace_id as unknown as ActivityId,
    agent: t.name,
    status: t.has_error ? 'failed' : 'completed',
    time: relTime(t.start_time_ms),
    cost: t.total_cost_usd,
    latency: parseFloat((t.duration_ms / 1000).toFixed(1)),
  }));

// ── Page ────────────────────────────────────────────────────────────────────

export function OverviewLivePage({ range, setView, setSelected, tweaks }: OverviewLivePageProps) {
  const feedPosition = tweaks.feedPosition ?? 'right';

  const kpis = useKpis(range);
  const cost = useCostSeries(range);
  const latency = useLatencySeries(range);
  const agents = useTopAgents(range);
  const failures = useFailures(range);
  const errorSeries = useErrorSeries(range);
  const anomalies = useAnomalies(range);
  const activity = useRecentActivity();

  // Outliers (design 1b + 1c). Dismissal is session-local (there is no dismiss
  // endpoint yet); selection is shared so a chart flag and the panel stay in sync.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [selectedOutlier, setSelectedOutlier] = useState<string | null>(null);

  // No runs in the window: either nothing has ever been ingested (onboarding
  // empty state) or there just weren't any traces in the selected range. The
  // activity feed lists the latest traces with no time bound, so it tells the
  // two apart; while it's still loading, fall through to the sections' own
  // spinners rather than flashing the wrong message.
  //
  // Cost can come from the metric source independently of spans, so a
  // workspace that only emits token-usage metrics has runs === 0 but non-zero
  // cost. That's real spend, not an empty workspace — render the dashboard.
  if (
    kpis.isSuccess &&
    kpis.data.runs.value === 0 &&
    kpis.data.cost.value === 0 &&
    activity.isSuccess
  ) {
    const hasAnyTraces = activity.data.items.length > 0;
    return hasAnyTraces ? (
      <EmptyState
        message={`No traces in the ${RANGE_LABEL[range] ?? RANGE_LABEL['7d']}`}
        description="Your agents haven't reported any activity in this window. Try a wider time range to see earlier traces."
      />
    ) : (
      <div>
        <EmptyState
          message="Connect your application to see data"
          description="Add this workspace’s ID to your OpenTelemetry configuration, then send your first trace."
        />
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0 24px 40px' }}>
          <button onClick={() => setView('settings')} style={{ padding: '9px 16px', borderRadius: 7, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--accent-contrast)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Get workspace ID & setup</button>
        </div>
      </div>
    );
  }

  const status = syncStatus([kpis, cost, latency, agents, failures, errorSeries, activity]);

  const costPoints = cost.data ? toCostPoints(cost.data.items, range) : [];
  const latencyPoints = latency.data ? toLatencyPoints(latency.data.items, range) : [];
  const summary = failures.data ? failuresSummary(failures.data.items, failures.data.total) : null;
  const errorPoints = errorSeries.data ? toErrorPoints(errorSeries.data.items, range) : [];

  // Detection is daily/rollup-backed, so outliers are unavailable for 24h (the
  // hook is disabled there); render no outlier UI in that case.
  const outliersAvailable = range !== '24h';
  const allAnoms = anomalies.data?.items ?? [];
  const liveAnoms = allAnoms.filter((a) => !dismissed.has(anomalyKey(a)));
  const dismissedCount = allAnoms.length - liveAnoms.length;
  const costAxisMs = cost.data ? cost.data.items.map((b) => b.bucket_ms) : [];
  const errorAxisMs = errorSeries.data ? errorSeries.data.items.map((b) => b.bucket_ms) : [];
  const selectOutlier = (a: Anomaly) => setSelectedOutlier(anomalyKey(a));
  const costMarkers = toChartMarkers(
    liveAnoms.filter((a) => a.metric === 'cost'),
    costAxisMs,
    { label: (a) => anomalyValue(a.metric, a.observed), onSelect: selectOutlier },
  );
  // Only error-rate anomalies belong on the failures strip; run-volume shifts
  // aren't failures, so they surface in the chips and panel instead.
  const errorMarkers = toChartMarkers(
    liveAnoms.filter((a) => a.metric === 'error_rate'),
    errorAxisMs,
    { onSelect: selectOutlier },
  );
  const dismissOutlier = (a: Anomaly) => setDismissed((s) => new Set(s).add(anomalyKey(a)));
  const inspectOutlier = (a: Anomaly) => {
    if (a.agent) setSelected((s) => ({ ...s, agent: a.agent }));
    setView('agents');
  };

  return (
    <OverviewLayout
      feedPosition={feedPosition}
      masthead={
        <Masthead
          eyebrow="Workspace"
          title="Overview"
          subtitle={`Workspace health and AI spend across the ${RANGE_LABEL[range] ?? RANGE_LABEL['7d']}.`}
          status={status}
        />
      }
      kpis={
        <Section isLoading={kpis.isLoading} isError={kpis.isError}>
          {kpis.data && <KpiStrip items={toKpiItems(kpis.data, costPoints, latencyPoints, errorPoints, range)} />}
        </Section>
      }
      outlierChips={
        outliersAvailable && anomalies.data ? <OutlierChips anomalies={liveAnoms} /> : undefined
      }
      charts={
        <Section
          isLoading={cost.isLoading || latency.isLoading}
          isError={cost.isError || latency.isError}
          minHeight={240}
        >
          <ChartsRow costSeries={costPoints} latSeries={latencyPoints} range={range} costMarkers={costMarkers} />
        </Section>
      }
      outliers={
        outliersAvailable ? (
          <Section isLoading={anomalies.isLoading} isError={anomalies.isError}>
            {anomalies.data && (
              <OutliersPanel
                anomalies={liveAnoms}
                range={range}
                dismissedCount={dismissedCount}
                selectedKey={selectedOutlier}
                onSelectKey={setSelectedOutlier}
                onDismiss={dismissOutlier}
                onRestoreAll={() => setDismissed(new Set())}
                onInspect={inspectOutlier}
              />
            )}
          </Section>
        ) : undefined
      }
      failures={
        <Section
          isLoading={failures.isLoading || errorSeries.isLoading}
          isError={failures.isError || errorSeries.isError}
        >
          {summary && (
            <FailuresBlock
              series={errorPoints}
              totalFailed={summary.totalFailed}
              worstAgent={summary.worstAgent}
              onViewAgents={() => setView('agents')}
              range={range}
              errorMarkers={errorMarkers}
            />
          )}
        </Section>
      }
      feed={
        <Section isLoading={activity.isLoading} isError={activity.isError}>
          {activity.data && (
            <ActivityFeed
              items={toActivityItems(activity.data.items)}
              onSelectTrace={(id) => {
                setSelected((s) => ({ ...s, traceId: id }));
                setView('trace');
              }}
            />
          )}
        </Section>
      }
      agents={
        <Section isLoading={agents.isLoading} isError={agents.isError}>
          {agents.data && (
            <TopAgents
              range={range}
              agents={toAgentRows(agents.data.items)}
              onSelectAgent={(name) => {
                setSelected((s) => ({ ...s, agent: name }));
                setView('agents');
              }}
            />
          )}
        </Section>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// OverviewPage — the demo overview shown in the logged-out auth-page preview.
// It renders the shared editorial sections from static demo data and a
// simulated live feed. The live (signed-in) variant is OverviewLivePage.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import {
  Masthead,
  KpiStrip,
  ChartsRow,
  FailuresBlock,
  TopAgents,
  ActivityFeed,
  OverviewLayout,
  OutlierChips,
  OutliersPanel,
} from '../components';
import type { KpiItem, TopAgentRow } from '../components';
import type { Anomaly } from '../interfaces';
import { anomalyKey, anomalyValue, toChartMarkers } from '../utils/anomalies';
import { fmtNum } from '../../../common';
import { AGENTS } from '../../agents';
import {
  ACTIVITY_FEED,
  COST_SERIES_7D,
  COST_SERIES_24H,
  COST_SERIES_30D,
  LATENCY_SERIES_7D,
  LATENCY_SERIES_24H,
  LATENCY_SERIES_30D,
  ERROR_SERIES_7D,
} from '../data';
import type { ActivityItem } from '../interfaces';
import type { ActivityId } from '../ids';

export interface Tweaks {
  feedPosition: 'left' | 'right';
}

export interface OverviewPageProps {
  range: string;
  setView: (v: string) => void;
  setSelected: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  tweaks: Tweaks;
}

const RANGE_LABEL: Record<string, string> = {
  '24h': 'last 24 hours',
  '30d': 'last 30 days',
  '7d': 'last 7 days',
};

// Most-used agents for the volume list: busiest first, carrying the trend the
// editorial row renders.
const TOP_AGENTS: TopAgentRow[] = AGENTS.slice()
  .sort((a, b) => b.calls - a.calls)
  .slice(0, 6)
  .map((a) => ({ name: a.name, calls: a.calls, cost: a.cost, trend: a.trend }));

// Demo outliers for the logged-out preview — four flagged buckets over a 7-day
// axis (two cost spikes, one error-rate spike, one volume surge), mirroring the
// live /metrics/anomalies payload so the outlier surfaces render without a
// backend. Observed cost values are read off the demo cost series so the flags
// sit on the right bars.
const DAY_MS = 86_400_000;
function buildDemoOutliers(cost: { value: number }[]): { axisMs: number[]; anomalies: Anomaly[] } {
  const n = cost.length; // 7 for the 7d series
  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const axisMs = Array.from({ length: n }, (_, i) => today - (n - 1 - i) * DAY_MS);
  // Anchor the cost outliers on the tallest bars so the flags sit on real spikes
  // and observed > expected holds (the live API guarantees this; the demo has to
  // arrange it by hand).
  const byHeight = cost.map((c, i) => ({ i, v: c.value })).sort((a, b) => b.v - a.v);
  const bigIdx = byHeight[0]?.i ?? n - 1;
  const midIdx = byHeight[1]?.i ?? Math.max(0, n - 2);
  const bigVal = cost[bigIdx]?.value ?? 4.71;
  const midVal = cost[midIdx]?.value ?? 0.34;
  const anomalies: Anomaly[] = [
    // Scores match the backend's severity bands (info ≥3, warning ≥4.5, critical
    // ≥6). checkout-agent trips both cost and errors on the same day so the
    // grouped view has a multi-flag incident to show; the rest are single flags.
    { metric: 'cost', scope: 'agent', agent: 'checkout-agent', bucket_ms: axisMs[bigIdx], observed: bigVal, expected: bigVal / 4.6, deviation: bigVal - bigVal / 4.6, score: 6.4, direction: 'spike', severity: 'critical', summary: 'Agent "checkout-agent" cost spiked, 4.6× the typical day.' },
    { metric: 'error_rate', scope: 'agent', agent: 'checkout-agent', bucket_ms: axisMs[bigIdx], observed: 0.22, expected: 0.05, deviation: 0.17, score: 5.2, direction: 'spike', severity: 'warning', summary: 'Agent "checkout-agent" error rate rose to 22% the same day.' },
    { metric: 'error_rate', scope: 'agent', agent: 'support-ticket-resolver', bucket_ms: axisMs[Math.min(n - 1, 5)], observed: 0.19, expected: 0.04, deviation: 0.15, score: 7.1, direction: 'spike', severity: 'critical', summary: 'Agent "support-ticket-resolver" error rate rose to 19%.' },
    { metric: 'runs', scope: 'workspace', agent: '', bucket_ms: axisMs[Math.min(n - 1, 3)], observed: 512, expected: 190, deviation: 322, score: 4.8, direction: 'spike', severity: 'warning', summary: 'Workspace run volume rose to 512, 2.7× the typical day.' },
    { metric: 'cost', scope: 'agent', agent: 'invoice-parser', bucket_ms: axisMs[midIdx], observed: midVal, expected: midVal / 2.4, deviation: midVal - midVal / 2.4, score: 3.4, direction: 'spike', severity: 'info', summary: 'Agent "invoice-parser" is drifting 2.4× costlier per run.' },
  ];
  return { axisMs, anomalies };
}

// ---------------------------------------------------------------------------
// Simulated live feed — ages existing rows and prepends a fresh event so the
// activity list ticks like a real stream.
// ---------------------------------------------------------------------------

const FEED_AGENTS = ['summarize-comments', 'classify-intent', 'detect-sentiment', 'moderate-content', 'extract-entities', 'rewrite-message'];
const FEED_ERRORS = ['rate_limit_exceeded', 'timeout', 'context_length'];
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function useSimulatedFeed(): ActivityItem[] {
  const [items, setItems] = useState<ActivityItem[]>(ACTIVITY_FEED);

  useEffect(() => {
    const id = setInterval(() => {
      setItems((prev) => {
        const failed = Math.random() < 1 / 6;
        const next: ActivityItem = {
          id: ('t_' + Math.random().toString(16).slice(2, 8)) as ActivityId,
          agent: pick(FEED_AGENTS),
          status: failed ? 'failed' : 'completed',
          time: 'just now',
          cost: parseFloat((Math.random() * 0.002).toFixed(4)),
          latency: parseFloat((Math.random() * 3 + 0.3).toFixed(1)),
          msg: failed ? pick(FEED_ERRORS) : undefined,
        };
        const aged = prev.map((it) => (it.time === 'just now' ? { ...it, time: '2s ago' } : it));
        return [next, ...aged].slice(0, 40);
      });
    }, 3400);
    return () => clearInterval(id);
  }, []);

  return items;
}

// ---------------------------------------------------------------------------
// OverviewPage (demo)
// ---------------------------------------------------------------------------

export function OverviewPage({ range, setView, setSelected, tweaks }: OverviewPageProps) {
  const feedPosition = tweaks.feedPosition ?? 'right';
  const feedItems = useSimulatedFeed();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [selectedOutlier, setSelectedOutlier] = useState<string | null>(null);

  const costSeries = range === '24h' ? COST_SERIES_24H : range === '30d' ? COST_SERIES_30D : COST_SERIES_7D;
  const latSeries = range === '24h' ? LATENCY_SERIES_24H : range === '30d' ? LATENCY_SERIES_30D : LATENCY_SERIES_7D;

  // Demo outliers are wired for the default 7d range (its axis matches the demo
  // error series), so the outlier surfaces are visible in the logged-out preview.
  const showOutliers = range === '7d';
  const demo = showOutliers ? buildDemoOutliers(costSeries) : null;
  const liveAnoms = demo ? demo.anomalies.filter((a) => !dismissed.has(anomalyKey(a))) : [];
  const costMarkers = demo
    ? toChartMarkers(liveAnoms.filter((a) => a.metric === 'cost'), demo.axisMs, {
        label: (a) => anomalyValue(a.metric, a.observed),
        onSelect: (a) => setSelectedOutlier(anomalyKey(a)),
      })
    : [];
  const errorMarkers = demo
    ? toChartMarkers(liveAnoms.filter((a) => a.metric === 'error_rate'), demo.axisMs, {
        onSelect: (a) => setSelectedOutlier(anomalyKey(a)),
      })
    : [];
  const dismissOutlier = (a: Anomaly) => setDismissed((s) => new Set(s).add(anomalyKey(a)));
  const inspectOutlier = (a: Anomaly) => {
    if (a.agent) setSelected((s) => ({ ...s, agent: a.agent }));
    setView('agents');
  };

  const totalCost = costSeries.reduce((s, d) => s + d.value, 0);
  const allTraces = AGENTS.reduce((s, a) => s + a.calls, 0);
  // error_rate is a fraction (0–1); failedCount sums failed runs, errorRate is the percent shown.
  const failedRuns = AGENTS.reduce((s, a) => s + a.error_rate * a.calls, 0);
  const errorRate = (failedRuns / allTraces) * 100;
  const failedCount = Math.round(failedRuns);
  const p95Vals = latSeries.map((d) => d.p95).filter((v): v is number => v != null);
  const p95 = p95Vals.reduce((s, v) => s + v, 0) / (p95Vals.length || 1);
  const totalFailed = ERROR_SERIES_7D.reduce((s, d) => s + d.errors, 0);

  const kpis: KpiItem[] = [
    {
      label: 'Total spend',
      value: '$' + totalCost.toFixed(totalCost < 1 ? 4 : 2),
      delta: '-12%',
      deltaTone: 'good',
      sparkData: costSeries.map((d) => d.value),
      hint: 'vs prev period',
    },
    {
      label: 'Traces',
      value: fmtNum(allTraces),
      delta: '+14%',
      deltaTone: 'good',
      sparkData: [120, 145, 132, 168, 180, 175, 210],
      hint: `${fmtNum(allTraces - failedCount)} completed`,
    },
    {
      label: 'Failure rate',
      value: errorRate.toFixed(2) + '%',
      delta: errorRate > 0.5 ? '+0.4 pts' : '0 pts',
      deltaTone: errorRate > 0.5 ? 'bad' : 'good',
      sparkData: ERROR_SERIES_7D.map((d) => (d.errors / Math.max(1, d.total)) * 100),
      sparkColor: errorRate > 2 ? 'var(--error)' : 'var(--warning)',
      hint: `${failedCount} failed runs`,
    },
    {
      label: 'p95 latency',
      value: p95.toFixed(2) + 's',
      delta: '+0.3s',
      deltaTone: 'bad',
      sparkData: latSeries.map((d) => d.p95),
      sparkColor: 'var(--foreground)',
      hint: 'p99 spikes 2×',
    },
  ];

  return (
    <OverviewLayout
      feedPosition={feedPosition}
      masthead={
        <Masthead
          title="Overview"
          subtitle={`Workspace health and AI spend across the ${RANGE_LABEL[range] ?? RANGE_LABEL['7d']}.`}
        />
      }
      kpis={<KpiStrip items={kpis} />}
      outlierChips={showOutliers ? <OutlierChips anomalies={liveAnoms} /> : undefined}
      charts={<ChartsRow costSeries={costSeries} latSeries={latSeries} range={range} costMarkers={costMarkers} />}
      outliers={
        showOutliers && demo ? (
          <OutliersPanel
            anomalies={liveAnoms}
            range={range}
            dismissedCount={demo.anomalies.length - liveAnoms.length}
            selectedKey={selectedOutlier}
            onSelectKey={setSelectedOutlier}
            onDismiss={dismissOutlier}
            onRestoreAll={() => setDismissed(new Set())}
            onInspect={inspectOutlier}
          />
        ) : undefined
      }
      failures={
        <FailuresBlock
          series={ERROR_SERIES_7D}
          totalFailed={totalFailed}
          worstAgent="rewrite-message"
          onViewAgents={() => setView('agents')}
          range={range}
          errorMarkers={errorMarkers}
        />
      }
      feed={
        <ActivityFeed
          items={feedItems}
          onSelectTrace={(id) => {
            setSelected((s) => ({ ...s, traceId: id }));
            setView('trace');
          }}
        />
      }
      agents={
        <TopAgents
          range={range}
          agents={TOP_AGENTS}
          onSelectAgent={(name) => {
            setSelected((s) => ({ ...s, agent: name }));
            setView('agents');
          }}
        />
      }
    />
  );
}

export default OverviewPage;

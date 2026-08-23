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
} from '../components';
import type { KpiItem, TopAgentRow } from '../components';
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

  const costSeries = range === '24h' ? COST_SERIES_24H : range === '30d' ? COST_SERIES_30D : COST_SERIES_7D;
  const latSeries = range === '24h' ? LATENCY_SERIES_24H : range === '30d' ? LATENCY_SERIES_30D : LATENCY_SERIES_7D;

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
      charts={<ChartsRow costSeries={costSeries} latSeries={latSeries} range={range} />}
      failures={
        <FailuresBlock
          series={ERROR_SERIES_7D}
          totalFailed={totalFailed}
          worstAgent="rewrite-message"
          onViewAgents={() => setView('agents')}
          range={range}
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

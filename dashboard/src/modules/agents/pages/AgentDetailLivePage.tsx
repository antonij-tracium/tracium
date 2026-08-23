// ---------------------------------------------------------------------------
// AgentDetailLivePage — the signed-in agent detail view. It fetches the agent's
// headline metrics, its three bounded agent-scoped series, and a page of its
// recent runs, then hands them to the presentational AgentDetailPage.
//
// Agent detail is a raw-window feature (≤30d): per-agent latency can't come from
// the daily rollup, so the server rejects longer ranges. We short-circuit those
// here with an explanatory state rather than firing a request that 400s.
//
// The configuration panel is trimmed to what spans can source (model, provider,
// tokens) — there is no agent-config store, so runtime params aren't shown.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import {
  EmptyState,
  Spinner,
  fmtNum,
  relativeTime,
  toCostPoints,
  toLatencyPoints,
  toErrorPoints,
  isLongRange,
} from '../../../common';
import type { Trace } from '../../trace-explorer/interfaces';
import {
  useAgentDetail,
  useAgentCostSeries,
  useAgentLatencySeries,
  useAgentErrorSeries,
  useAgentRuns,
} from '../hooks/useAgentDetail';
import { deriveRunOutcomes } from '../utils';
import { AgentDetailPage, type AgentConfigRow } from './AgentDetailPage';
import type { AgentRun } from '../interfaces';

interface AgentDetailLivePageProps {
  agentName: string;
  range: string;
  setView: (v: string) => void;
  setSelected: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
        color: 'var(--muted)',
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

// A trace becomes a run row. The trace list carries no token totals, so Tokens
// reads "—" (tokens: null); status is the trace's error outcome, not agent health.
function toRun(t: Trace): AgentRun {
  return {
    id: t.trace_id,
    status: t.has_error ? 'failed' : 'completed',
    time: relativeTime(t.start_time_ms),
    duration: t.duration_ms,
    cost: t.total_cost_usd,
    tokens: null,
    err: null,
  };
}

export function AgentDetailLivePage({ agentName, range, setView, setSelected }: AgentDetailLivePageProps) {
  // The detail endpoint and the agent-scoped series both reject rollup ranges,
  // so disable the fetches at 90d/1y. Hooks are still called unconditionally
  // (stable order) — `enabled` skips the request rather than a conditional call.
  const enabled = !isLongRange(range);
  const detail = useAgentDetail(agentName, range, enabled);
  const cost = useAgentCostSeries(agentName, range, enabled);
  const latency = useAgentLatencySeries(agentName, range, enabled);
  const errors = useAgentErrorSeries(agentName, range, enabled);
  const runs = useAgentRuns(agentName, range, enabled);

  if (!enabled) {
    return (
      <EmptyState
        message="Agent detail isn't available for long ranges"
        description="Per-agent latency isn't retained beyond 30 days. Switch to 24h, 7d, or 30d to see this agent's detail."
      />
    );
  }

  if (detail.isLoading) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  }
  if (detail.isError || !detail.data) {
    return <Centered>Failed to load agent</Centered>;
  }

  const d = detail.data;
  const { completed, failed } = deriveRunOutcomes(d.calls, d.error_rate);

  const configRows: AgentConfigRow[] = [
    { label: 'model', value: d.model || '—', mono: true },
    ...(d.provider ? [{ label: 'provider', value: d.provider } as AgentConfigRow] : []),
    { label: 'input tokens', value: fmtNum(d.input_tokens), mono: true },
    { label: 'output tokens', value: fmtNum(d.output_tokens), mono: true },
  ];

  return (
    <AgentDetailPage
      name={d.name}
      model={d.model || '—'}
      provider={d.provider || undefined}
      range={range}
      calls={d.calls}
      completed={completed}
      failed={failed}
      cost={d.cost}
      p95Ms={d.p95_latency_ms}
      errorRate={d.error_rate}
      configRows={configRows}
      costSeries={cost.data ? toCostPoints(cost.data.items, range) : []}
      latencySeries={latency.data ? toLatencyPoints(latency.data.items, range) : []}
      errorSeries={errors.data ? toErrorPoints(errors.data.items, range) : []}
      runs={runs.data ? runs.data.items.map(toRun) : []}
      setView={setView}
      setSelected={setSelected}
    />
  );
}

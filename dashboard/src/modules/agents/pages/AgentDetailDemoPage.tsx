// ---------------------------------------------------------------------------
// AgentDetailDemoPage — the embedded (logged-out preview) agent detail. It
// assembles the presentational AgentDetailPage's props from the mock AGENTS +
// AGENT_META and the deterministic demo series, so the auth-page preview shows a
// fully-populated agent without hitting the API. The live app uses
// AgentDetailLivePage instead.
// ---------------------------------------------------------------------------

import { fmtNum } from '../../../common';
import type { LatencyPoint } from '../../../common/interfaces';
import { AGENT_META, DEFAULT_AGENT_META } from '../data';
import { buildCostSeries, buildLatencySeries, buildErrorSeries, buildRuns, deriveRunOutcomes } from '../utils';
import { AgentDetailPage, type AgentConfigRow } from './AgentDetailPage';
import type { Agent } from '../interfaces';

interface AgentDetailDemoPageProps {
  agent: Agent;
  range: string;
  setView: (v: string) => void;
  setSelected: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
}

// The demo latency series is in seconds (see series.ts); the page wants p95 in ms.
function p95Ms(series: LatencyPoint[]): number | null {
  const vals = series.map((d) => d.p95 ?? 0);
  return vals.length ? Math.max(...vals) * 1000 : null;
}

export function AgentDetailDemoPage({ agent, range, setView, setSelected }: AgentDetailDemoPageProps) {
  const meta = AGENT_META[agent.name] ?? DEFAULT_AGENT_META;
  const costSeries = buildCostSeries(agent, range);
  const latencySeries = buildLatencySeries(agent, range);
  const errorSeries = buildErrorSeries(agent, range);
  const runs = buildRuns(agent);
  const { completed, failed } = deriveRunOutcomes(agent.calls, agent.error_rate);

  const configRows: AgentConfigRow[] = [
    { label: 'endpoint', value: meta.endpoint, mono: true },
    { label: 'model', value: meta.model, mono: true },
    { label: 'provider', value: meta.provider },
    { label: 'version', value: meta.version, mono: true, accent: true },
    { label: 'temperature', value: meta.temperature.toFixed(1), mono: true },
    { label: 'max_tokens', value: fmtNum(meta.maxTokens), mono: true },
    { label: 'timeout', value: meta.timeout, mono: true },
    { label: 'retries', value: meta.retries, mono: true },
  ];

  return (
    <AgentDetailPage
      name={agent.name}
      version={meta.version}
      model={meta.model}
      provider={meta.provider}
      deploy={meta.lastDeploy}
      description={meta.description}
      range={range}
      calls={agent.calls}
      completed={completed}
      failed={failed}
      cost={agent.cost}
      p95Ms={p95Ms(latencySeries)}
      errorRate={agent.error_rate}
      configRows={configRows}
      costSeries={costSeries}
      latencySeries={latencySeries}
      errorSeries={errorSeries}
      runs={runs}
      setView={setView}
      setSelected={setSelected}
    />
  );
}

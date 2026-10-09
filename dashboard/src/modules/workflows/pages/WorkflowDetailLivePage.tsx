import {
  Centered,
  EmptyState,
  Spinner,
  fmtNum,
  toCostPoints,
  toLatencyPoints,
  toErrorPoints,
  isLongRange,
} from '../../../common';
import { toRunRow } from '../../trace-explorer';
import {
  useWorkflowDetail,
  useWorkflowCostSeries,
  useWorkflowLatencySeries,
  useWorkflowErrorSeries,
  useWorkflowRuns,
} from '../hooks/useWorkflowDetail';
import { deriveRunOutcomes } from '../utils';
import { WorkflowDetailPage } from './WorkflowDetailPage';
import type { MetaRowProps } from '../../../common';

interface WorkflowDetailLivePageProps {
  workflowName: string;
  range: string;
  setView: (v: string) => void;
  setSelected: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
}

export function WorkflowDetailLivePage({ workflowName, range, setView, setSelected }: WorkflowDetailLivePageProps) {
  // The detail endpoints reject rollup ranges, so skip the requests there.
  const enabled = !isLongRange(range);
  const detail = useWorkflowDetail(workflowName, range, enabled);
  const cost = useWorkflowCostSeries(workflowName, range, enabled);
  const latency = useWorkflowLatencySeries(workflowName, range, enabled);
  const errors = useWorkflowErrorSeries(workflowName, range, enabled);
  const runs = useWorkflowRuns(workflowName, range, enabled);

  if (!enabled) {
    return (
      <EmptyState
        message="Workflow detail isn't available for long ranges"
        description="Per-workflow latency isn't retained beyond 30 days. Switch to 24h, 7d, or 30d to see this workflow's detail."
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
  if (!detail.data) {
    return <Centered>Failed to load workflow</Centered>;
  }

  const d = detail.data;
  const { completed, failed } = deriveRunOutcomes(d.calls, d.error_rate);

  const configRows: MetaRowProps[] = [
    { label: 'model', value: d.model || '—', mono: true },
    ...(d.provider ? [{ label: 'provider', value: d.provider }] : []),
    { label: 'input tokens', value: fmtNum(d.input_tokens), mono: true },
    { label: 'output tokens', value: fmtNum(d.output_tokens), mono: true },
  ];

  return (
    <WorkflowDetailPage
      name={d.name}
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
      runs={runs.data ? runs.data.items.map(toRunRow) : []}
      loadErrors={{
        cost: cost.isError && !cost.data,
        latency: latency.isError && !latency.data,
        errors: errors.isError && !errors.data,
        runs: runs.isError && !runs.data,
      }}
      setView={setView}
      setSelected={setSelected}
    />
  );
}

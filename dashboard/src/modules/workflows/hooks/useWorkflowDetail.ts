import { useQuery } from '@tanstack/react-query';
import { useAPIClient } from '../../../common/providers/APIProvider';

// Workflow detail refreshes on the same 1-minute grid as the workflows list: the
// server snaps the window to that grid and serves it from ClickHouse's query
// cache, so many dashboards polling at once collapse onto ~one scan per minute.
// Background (hidden) tabs don't poll.
const DETAIL_REFRESH_MS = 60_000;

// Number of recent runs shown on the detail page. Small and bounded — this is a
// single page of the workflow's traces, never an unbounded scan.
export const WORKFLOW_RUNS_PAGE_SIZE = 10;

// `enabled` lets the page keep hook order stable while skipping the fetch when
// there's nothing to request (e.g. a rollup range the endpoint would reject).
const shared = (enabled: boolean) => ({
  staleTime: DETAIL_REFRESH_MS,
  refetchInterval: DETAIL_REFRESH_MS,
  refetchIntervalInBackground: false,
  enabled,
});

// One workflow's headline metrics + tool surface. Keyed by name+range so switching
// either refetches. The server rejects rollup ranges (>30d) with a 400, so the
// page disables these hooks for those ranges.
export function useWorkflowDetail(name: string, range: string, enabled = true) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['workflows', 'detail', workspaceId, name, range],
    queryFn: () => metricsAPI.getWorkflowDetail(name, range),
    ...shared(enabled),
  });
}

// The workflow's three detail charts, each its own bounded, workflow-scoped series so
// they load and refresh independently — same pattern as the overview charts.
export function useWorkflowCostSeries(name: string, range: string, enabled = true) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['workflows', 'cost-series', workspaceId, name, range],
    queryFn: () => metricsAPI.getCostSeries(range, name),
    ...shared(enabled),
  });
}

export function useWorkflowLatencySeries(name: string, range: string, enabled = true) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['workflows', 'latency-series', workspaceId, name, range],
    queryFn: () => metricsAPI.getLatencySeries(range, name),
    ...shared(enabled),
  });
}

export function useWorkflowErrorSeries(name: string, range: string, enabled = true) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['workflows', 'error-series', workspaceId, name, range],
    queryFn: () => metricsAPI.getErrorSeries(range, name),
    ...shared(enabled),
  });
}

// The workflow's most recent runs, as a bounded page of its traces (newest first).
export function useWorkflowRuns(name: string, range: string, enabled = true) {
  const { tracesAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['workflows', 'runs', workspaceId, name, range],
    queryFn: () => tracesAPI.listTraces({ workflow: name, range, page_size: WORKFLOW_RUNS_PAGE_SIZE }),
    ...shared(enabled),
  });
}

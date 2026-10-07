import { useQuery } from '@tanstack/react-query';
import { useAPIClient } from '../../../common/providers/APIProvider';

// Same 1-minute refresh grid as the workflows list.
const DETAIL_REFRESH_MS = 60_000;

const WORKFLOW_RUNS_PAGE_SIZE = 10;

const shared = (enabled: boolean) => ({
  staleTime: DETAIL_REFRESH_MS,
  refetchInterval: DETAIL_REFRESH_MS,
  refetchIntervalInBackground: false,
  enabled,
});

export function useWorkflowDetail(name: string, range: string, enabled = true) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['workflows', 'detail', workspaceId, name, range],
    queryFn: () => metricsAPI.getWorkflowDetail(name, range),
    ...shared(enabled),
  });
}

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

export function useWorkflowRuns(name: string, range: string, enabled = true) {
  const { tracesAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['workflows', 'runs', workspaceId, name, range],
    queryFn: () => tracesAPI.listTraces({ workflow: name, range, page_size: WORKFLOW_RUNS_PAGE_SIZE }),
    ...shared(enabled),
  });
}

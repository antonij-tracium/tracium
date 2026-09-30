import { useQuery } from '@tanstack/react-query';
import { useAPIClient } from '../../../common/providers/APIProvider';
import type { UserId } from '../../../common/ids';

// An empty user_id would return workspace-wide numbers, so every query waits for a client id.

export const CLIENT_TRACES_PAGE_SIZE = 15;

export function useClientKpis(userId: string, range: string) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['clients', 'kpis', workspaceId, userId, range],
    queryFn: () => metricsAPI.getKpis(range, userId),
    enabled: !!userId,
  });
}

export function useClientCostSeries(userId: string, range: string) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['clients', 'cost-series', workspaceId, userId, range],
    queryFn: () => metricsAPI.getCostSeries(range, undefined, userId),
    enabled: !!userId,
  });
}

export function useClientErrorSeries(userId: string, range: string) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['clients', 'error-series', workspaceId, userId, range],
    queryFn: () => metricsAPI.getErrorSeries(range, undefined, userId),
    enabled: !!userId,
  });
}

export function useClientModelCosts(userId: string, range: string) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['clients', 'model-costs', workspaceId, userId, range],
    queryFn: () => metricsAPI.getModelCosts(range, userId),
    enabled: !!userId,
  });
}

export function useClientWorkflowUsage(userId: string, range: string) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['clients', 'workflows', workspaceId, userId, range],
    queryFn: () => metricsAPI.getWorkflowUsage(range, userId),
    enabled: !!userId,
  });
}

export function useClientTraces(userId: string, range: string) {
  const { tracesAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['clients', 'traces', workspaceId, userId, range],
    queryFn: () =>
      tracesAPI.listTraces({ user_id: userId as UserId, range, page_size: CLIENT_TRACES_PAGE_SIZE }),
    enabled: !!userId,
  });
}

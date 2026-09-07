import { useQuery } from '@tanstack/react-query';
import { useAPIClient } from '../../../common/providers/APIProvider';

// Usage-page breakdowns. The KPI strip and daily chart reuse the overview
// metrics hooks (useKpis / useCostSeries / useErrorSeries); these three cover
// the page's own breakdown endpoints. All keyed by range, so the range selector
// refetches everything.

export function useModelCosts(range: string) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['usage', 'model-costs', workspaceId, range],
    queryFn: () => metricsAPI.getModelCosts(range),
  });
}

export function useUserUsage(range: string) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['usage', 'users', workspaceId, range],
    queryFn: () => metricsAPI.getUserUsage(range),
  });
}

export function useAgentUsage(range: string) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['usage', 'agents', workspaceId, range],
    queryFn: () => metricsAPI.getAgentUsage(range),
  });
}

// Custom-attribute allocation. useAttributeKeys discovers the dimensions the
// instrumentation tags spans with; useAttributeUsage allocates spend by one.
export function useAttributeKeys(range: string) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['usage', 'attribute-keys', workspaceId, range],
    queryFn: () => metricsAPI.getAttributeKeys(range),
  });
}

export function useAttributeUsage(range: string, key: string) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['usage', 'attribute-usage', workspaceId, range, key],
    queryFn: () => metricsAPI.getUsageByAttribute(range, key),
    enabled: key !== '',
  });
}

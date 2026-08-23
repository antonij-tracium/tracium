import { useQuery } from '@tanstack/react-query';
import { useAPIClient } from '../../../common/providers/APIProvider';

// One hook per overview section so each loads and refreshes independently.
// All are keyed by range, so flipping the range selector refetches everything.

export function useKpis(range: string) {
  const { metricsAPI } = useAPIClient();
  return useQuery({
    queryKey: ['overview', 'kpis', range],
    queryFn: () => metricsAPI.getKpis(range),
  });
}

export function useCostSeries(range: string) {
  const { metricsAPI } = useAPIClient();
  return useQuery({
    queryKey: ['overview', 'cost-series', range],
    queryFn: () => metricsAPI.getCostSeries(range),
  });
}

export function useLatencySeries(range: string) {
  const { metricsAPI } = useAPIClient();
  return useQuery({
    queryKey: ['overview', 'latency-series', range],
    queryFn: () => metricsAPI.getLatencySeries(range),
  });
}

export function useErrorSeries(range: string) {
  const { metricsAPI } = useAPIClient();
  return useQuery({
    queryKey: ['overview', 'error-series', range],
    queryFn: () => metricsAPI.getErrorSeries(range),
  });
}

export function useTopAgents(range: string) {
  const { metricsAPI } = useAPIClient();
  return useQuery({
    queryKey: ['overview', 'top-agents', range],
    queryFn: () => metricsAPI.getTopAgents(range),
  });
}

export function useFailures(range: string) {
  const { metricsAPI } = useAPIClient();
  return useQuery({
    queryKey: ['overview', 'failures', range],
    queryFn: () => metricsAPI.getFailures(range),
  });
}

// useRecentActivity powers the live feed off the most recent traces, polling
// every few seconds.
export function useRecentActivity() {
  const { tracesAPI } = useAPIClient();
  return useQuery({
    queryKey: ['overview', 'recent-activity'],
    queryFn: () => tracesAPI.listTraces({ page_size: 15 }),
    refetchInterval: 5000,
  });
}

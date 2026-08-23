import { useQuery } from '@tanstack/react-query';
import { useAPIClient } from '../../../common/providers/APIProvider';

// Refresh cadence for the Agents page. Aligned to the server's 1-minute query
// cache grid: the page updates on a predictable clock, and because the server
// snaps the window to that same minute and serves it from ClickHouse's query
// cache, many dashboards polling at once collapse onto ~one scan per minute per
// range rather than one scan each. So the auto-refresh is cheap, not a load
// multiplier. Background (hidden) tabs don't poll — that load buys nothing.
const AGENTS_REFRESH_MS = 60_000;

// Fetches the Agents page list, bounded by the active range. Keyed by range so
// flipping the range selector refetches; the server caps the row count, so this
// stays a single bounded request rather than an unbounded scan.
export function useAgents(range: string) {
  const { metricsAPI } = useAPIClient();
  return useQuery({
    queryKey: ['agents', 'list', range],
    queryFn: () => metricsAPI.getAgents(range),
    staleTime: AGENTS_REFRESH_MS,
    refetchInterval: AGENTS_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

import { useQuery } from '@tanstack/react-query';
import { useAPIClient } from '../../../common/providers/APIProvider';

// Refresh cadence for the Workflows page. Aligned to the server's 1-minute query
// cache grid: the page updates on a predictable clock, and because the server
// snaps the window to that same minute and serves it from ClickHouse's query
// cache, many dashboards polling at once collapse onto ~one scan per minute per
// range rather than one scan each. So the auto-refresh is cheap, not a load
// multiplier. Background (hidden) tabs don't poll — that load buys nothing.
const WORKFLOWS_REFRESH_MS = 60_000;

// Fetches the Workflows page list, bounded by the active range. Keyed by range so
// flipping the range selector refetches; the server caps the row count, so this
// stays a single bounded request rather than an unbounded scan.
export function useWorkflows(range: string) {
  const { metricsAPI, workspaceId } = useAPIClient();
  return useQuery({
    queryKey: ['workflows', 'list', workspaceId, range],
    queryFn: () => metricsAPI.getWorkflows(range),
    staleTime: WORKFLOWS_REFRESH_MS,
    refetchInterval: WORKFLOWS_REFRESH_MS,
    refetchIntervalInBackground: false,
  });
}

import { useQuery } from '@tanstack/react-query';
import { useAPIClient } from '../../../common/providers/APIProvider';
import type { UserId } from '../../../common/ids';
import { EmptyState, Spinner, costFormatter } from '../../../common';

interface Props {
  userId: string;
  range: string;
  setView: (view: string) => void;
  setSelected: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
}

export function UserDetailLivePage({ userId, range, setView, setSelected }: Props) {
  const { metricsAPI, tracesAPI, workspaceId } = useAPIClient();
  const usage = useQuery({
    queryKey: ['usage', 'user-detail', workspaceId, userId, range],
    queryFn: () => metricsAPI.getUserUsage(range, userId),
    enabled: !!userId,
  });
  const traces = useQuery({
    queryKey: ['usage', 'user-traces', workspaceId, userId, range],
    queryFn: () => tracesAPI.listTraces({ user_id: userId as UserId, range, page_size: 20 }),
    enabled: !!userId,
  });
  const user = usage.data?.items.find(item => item.user_id === userId);
  return <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
    <button onClick={() => setView('users')}>← Users</button>
    <h1>{userId || 'Unattributed usage'}</h1>
    <p>Usage in the selected workspace · {range}</p>
    {usage.isLoading ? <Spinner /> : usage.isError ? <p role="alert">Could not load user usage.</p> : !user ?
      <EmptyState message="No usage found" description="This user has no activity in the selected workspace and period." /> :
      <dl style={{ display: 'flex', gap: 36 }}>
        <div><dt>Cost</dt><dd>{costFormatter.format(user.cost)}</dd></div>
        <div><dt>Runs</dt><dd>{user.runs.toLocaleString()}</dd></div>
        <div><dt>Average cost per run</dt><dd>{costFormatter.format(user.runs ? user.cost / user.runs : 0)}</dd></div>
      </dl>}
    <h2>Recent traces</h2>
    {traces.isLoading ? <Spinner /> : traces.isError ? <p role="alert">Could not load traces.</p> :
      traces.data?.items.length ? <ul>{traces.data.items.map(trace => <li key={trace.trace_id}>
        <button onClick={() => { setSelected(prev => ({ ...prev, traceId: trace.trace_id })); setView('trace'); }}>
          {trace.name || trace.trace_id} · {costFormatter.format(trace.total_cost_usd)}
        </button>
      </li>)}</ul> : <p>No traces in this period.</p>}
  </div>;
}

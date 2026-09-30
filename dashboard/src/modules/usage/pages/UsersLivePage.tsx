// ---------------------------------------------------------------------------
// UsersLivePage — the signed-in Users view, fed by GET /v1/metrics/
// usage-users (range-bounded; cost scales with the query window, not the
// total user count). It owns the data fetch and hands telemetry-derived rows
// to the pure UsersPage. Loading / error / empty are handled here.
//
// Only telemetry-derived fields are available from the metrics endpoint
// (user id, runs, cost, trend). Region / success rate / last-seen are not
// telemetry, so the live table shows the telemetry columns only.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { EmptyState, Spinner, periodLabel } from '../../../common';
import { useUserUsage } from '../hooks/useUsage';
import { UsersPage, type User } from './UsersPage';

interface UsersLivePageProps {
  range: string;
  setView: (v: string) => void;
  setSelected: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
        color: 'var(--muted)',
        fontSize: 14,
      }}
    >
      {children}
    </div>
  );
}

export function UsersLivePage({ range, setView, setSelected }: UsersLivePageProps) {
  const { data, isLoading, isError, dataUpdatedAt } = useUserUsage(range);

  if (isLoading) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  }
  if (isError) {
    return <Centered>Failed to load clients</Centered>;
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        message="No clients yet"
        description="Clients appear as your workflows report activity tagged with a user.id."
      />
    );
  }

  const users: User[] = items.map((t) => ({
    id: t.user_id || '—',
    name: t.user_id || 'default',
    cost: t.cost,
    runs: t.runs,
    avg: t.runs > 0 ? t.cost / t.runs : 0,
    trend: t.trend ?? [],
  }));

  const comparison = {
    runs: items.reduce((s, t) => s + t.runs_prev, 0),
    cost: items.reduce((s, t) => s + t.cost_prev, 0),
  };

  return (
    <UsersPage
      users={users}
      periodLabel={periodLabel(range)}
      comparison={comparison}
      updatedAt={dataUpdatedAt}
      setView={setView}
      setSelected={setSelected}
    />
  );
}


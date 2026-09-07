// ---------------------------------------------------------------------------
// TenantsLivePage — the signed-in Tenants view, fed by GET /v1/metrics/
// usage-tenants (range-bounded; cost scales with the query window, not the
// total tenant count). It owns the data fetch and hands telemetry-derived rows
// to the pure TenantsPage. Loading / error / empty are handled here.
//
// Only telemetry-derived fields are available from the metrics endpoint
// (tenant id, runs, cost, trend). Plan / region / success rate / last-seen are
// not telemetry, so the live table shows the telemetry columns only.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { EmptyState, Spinner } from '../../../common';
import { useTenantUsage } from '../hooks/useUsage';
import { TenantsPage, type Tenant } from './TenantsPage';

interface TenantsLivePageProps {
  range: string;
  setView: (v: string) => void;
  setSelected: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
}

const RANGE_LABEL: Record<string, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '1y': 'Last year',
};

function Centered({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
        color: 'var(--muted)',
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

export function TenantsLivePage({ range, setView, setSelected }: TenantsLivePageProps) {
  const { data, isLoading, isError, dataUpdatedAt } = useTenantUsage(range);

  if (isLoading) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  }
  if (isError) {
    return <Centered>Failed to load tenants</Centered>;
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        message="No tenants yet"
        description="Tenants appear as your agents report tenant-scoped activity."
      />
    );
  }

  const tenants: Tenant[] = items.map((t) => ({
    id: t.tenant_id || '—',
    name: t.tenant_id || 'default',
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
    <TenantsPage
      tenants={tenants}
      periodLabel={RANGE_LABEL[range] ?? RANGE_LABEL['7d']}
      comparison={comparison}
      updatedAt={dataUpdatedAt}
      setView={setView}
      setSelected={setSelected}
    />
  );
}

export default TenantsLivePage;

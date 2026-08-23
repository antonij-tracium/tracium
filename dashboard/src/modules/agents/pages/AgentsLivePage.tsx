// ---------------------------------------------------------------------------
// AgentsLivePage — the signed-in Agents view, fed by GET /v1/metrics/agents.
// It owns the data fetch (the page is the composition layer) and hands the
// resolved list to the presentational AgentsPage. Loading / error / empty are
// handled here so AgentsPage stays a pure renderer.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { EmptyState, Spinner } from '../../../common';
import { useAgents } from '../hooks/useAgents';
import { AgentsPage } from './AgentsPage';

interface AgentsLivePageProps {
  range: string;
  setView: (v: string) => void;
  setSelected: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  workspaceName?: string;
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
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

export function AgentsLivePage({ range, setView, setSelected, workspaceName }: AgentsLivePageProps) {
  const { data, isLoading, isError, dataUpdatedAt } = useAgents(range);

  if (isLoading) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  }
  if (isError) {
    return <Centered>Failed to load agents</Centered>;
  }

  const agents = data?.items ?? [];
  if (agents.length === 0) {
    return (
      <EmptyState
        message="No agents yet"
        description="Agents appear here once they start emitting traces."
      />
    );
  }

  return (
    <AgentsPage
      agents={agents}
      setView={setView}
      setSelected={setSelected}
      workspaceName={workspaceName}
      updatedAt={dataUpdatedAt}
    />
  );
}

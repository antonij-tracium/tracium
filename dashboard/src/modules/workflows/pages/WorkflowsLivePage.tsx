// ---------------------------------------------------------------------------
// WorkflowsLivePage — the signed-in Workflows view, fed by GET /v1/metrics/workflows.
// It owns the data fetch (the page is the composition layer) and hands the
// resolved list to the presentational WorkflowsPage. Loading / error / empty are
// handled here so WorkflowsPage stays a pure renderer.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { EmptyState, Spinner } from '../../../common';
import { useWorkflows } from '../hooks/useWorkflows';
import { WorkflowsPage } from './WorkflowsPage';

interface WorkflowsLivePageProps {
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

export function WorkflowsLivePage({ range, setView, setSelected, workspaceName }: WorkflowsLivePageProps) {
  const { data, isLoading, isError, dataUpdatedAt } = useWorkflows(range);

  if (isLoading) {
    return (
      <Centered>
        <Spinner />
      </Centered>
    );
  }
  if (isError) {
    return <Centered>Failed to load workflows</Centered>;
  }

  const workflows = data?.items ?? [];
  if (workflows.length === 0) {
    return (
      <EmptyState
        message="No workflows yet"
        description="Workflows appear here once they start emitting traces."
      />
    );
  }

  return (
    <WorkflowsPage
      workflows={workflows}
      setView={setView}
      setSelected={setSelected}
      workspaceName={workspaceName}
      updatedAt={dataUpdatedAt}
    />
  );
}

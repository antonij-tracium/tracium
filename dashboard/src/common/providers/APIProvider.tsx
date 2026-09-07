import React, { createContext, useContext, useMemo, useState } from 'react';
import { TracesAPI } from '../api/traces';
import { MetricsAPI } from '../api/metrics';
import { WorkspacesAPI } from '../api/workspaces';
import type { APIClientConfig } from '../interfaces';

interface APIContextValue {
  tracesAPI: TracesAPI;
  metricsAPI: MetricsAPI;
  workspacesAPI: WorkspacesAPI;
  /**
   * The workspace every client is currently scoped to (undefined = unscoped).
   * Consumers MUST fold this into their react-query keys so a cached result
   * from one workspace is never shown for another, and switching workspaces
   * refetches with the freshly-rebuilt scoped client on its own.
   */
  workspaceId: string | undefined;
  /**
   * Scope every subsequent read to a workspace (or clear scoping with
   * undefined). The dashboard calls this when the active workspace changes;
   * the API clients are rebuilt so their requests carry the new workspace_id.
   */
  setWorkspaceId: (id: string | undefined) => void;
}

const APIContext = createContext<APIContextValue | null>(null);

interface APIProviderProps {
  config: APIClientConfig;
  children: React.ReactNode;
}

export function APIProvider({ config, children }: APIProviderProps) {
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(config.workspaceId);

  const value = useMemo(() => {
    const scopedConfig = { ...config, workspaceId };
    return {
      tracesAPI: new TracesAPI(scopedConfig),
      metricsAPI: new MetricsAPI(scopedConfig),
      workspacesAPI: new WorkspacesAPI(scopedConfig),
      workspaceId,
      setWorkspaceId,
    };
  }, [config, workspaceId]);

  return <APIContext.Provider value={value}>{children}</APIContext.Provider>;
}

export function useAPIClient(): APIContextValue {
  const ctx = useContext(APIContext);
  if (!ctx) throw new Error('useAPIClient must be used within APIProvider');
  return ctx;
}

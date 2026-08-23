import React, { createContext, useContext, useMemo } from 'react';
import { TracesAPI } from '../api/traces';
import { MetricsAPI } from '../api/metrics';
import { WorkspacesAPI } from '../api/workspaces';
import type { APIClientConfig } from '../interfaces';

interface APIContextValue {
  tracesAPI: TracesAPI;
  metricsAPI: MetricsAPI;
  workspacesAPI: WorkspacesAPI;
}

const APIContext = createContext<APIContextValue | null>(null);

interface APIProviderProps {
  config: APIClientConfig;
  children: React.ReactNode;
}

export function APIProvider({ config, children }: APIProviderProps) {
  const value = useMemo(
    () => ({
      tracesAPI: new TracesAPI(config),
      metricsAPI: new MetricsAPI(config),
      workspacesAPI: new WorkspacesAPI(config),
    }),
    [config],
  );

  return <APIContext.Provider value={value}>{children}</APIContext.Provider>;
}

export function useAPIClient(): APIContextValue {
  const ctx = useContext(APIContext);
  if (!ctx) throw new Error('useAPIClient must be used within APIProvider');
  return ctx;
}

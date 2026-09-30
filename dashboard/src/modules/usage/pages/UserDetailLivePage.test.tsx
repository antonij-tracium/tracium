import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDetailLivePage } from './UserDetailLivePage';

const api = vi.hoisted(() => ({
  getKpis: vi.fn(),
  getCostSeries: vi.fn(),
  getErrorSeries: vi.fn(),
  getModelCosts: vi.fn(),
  getWorkflowUsage: vi.fn(),
  listTraces: vi.fn(),
}));
vi.mock('../../../common/providers/APIProvider', () => ({
  useAPIClient: () => ({
    metricsAPI: {
      getKpis: api.getKpis,
      getCostSeries: api.getCostSeries,
      getErrorSeries: api.getErrorSeries,
      getModelCosts: api.getModelCosts,
      getWorkflowUsage: api.getWorkflowUsage,
    },
    tracesAPI: { listTraces: api.listTraces },
  }),
}));

const kpi = (value: number) => ({ value, delta: 0, delta_type: 'neutral' });
const kpis = (cost: number, runs: number) => ({
  cost: kpi(cost),
  runs: kpi(runs),
  error_rate: kpi(0.25),
  latency_p95: kpi(1200),
});
const empty = { items: [], total: 0, page: 1, page_size: 20 };

function show(userId: string) {
  const setView = vi.fn();
  const setSelected = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><UserDetailLivePage userId={userId} range="7d" setView={setView} setSelected={setSelected} /></QueryClientProvider>);
  return { setView, setSelected };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  api.getCostSeries.mockResolvedValue(empty);
  api.getErrorSeries.mockResolvedValue(empty);
  api.getModelCosts.mockResolvedValue(empty);
  api.getWorkflowUsage.mockResolvedValue(empty);
  api.listTraces.mockResolvedValue(empty);
});

afterEach(() => vi.unstubAllGlobals());

describe('live client details', () => {
  it('shows an empty state when the client has no usage', async () => {
    api.getKpis.mockResolvedValue(kpis(0, 0));
    show('missing-user');
    expect(await screen.findByText('No usage found')).toBeInTheDocument();
    expect(screen.queryByText('Workflows')).not.toBeInTheDocument();
  });

  it('scopes every request to the client', async () => {
    api.getKpis.mockResolvedValue(kpis(12, 8));
    show('customer-42');
    expect(await screen.findByText('Failure rate')).toBeInTheDocument();
    expect(api.getKpis).toHaveBeenCalledWith('7d', 'customer-42');
    expect(api.getCostSeries).toHaveBeenCalledWith('7d', undefined, 'customer-42');
    expect(api.getErrorSeries).toHaveBeenCalledWith('7d', undefined, 'customer-42');
    expect(api.getModelCosts).toHaveBeenCalledWith('7d', 'customer-42');
    expect(api.getWorkflowUsage).toHaveBeenCalledWith('7d', 'customer-42');
    expect(api.listTraces).toHaveBeenCalledWith({ user_id: 'customer-42', range: '7d', page_size: 15 });
  });

  it('opens a returned trace', async () => {
    api.getKpis.mockResolvedValue(kpis(12, 8));
    api.listTraces.mockResolvedValue({
      ...empty,
      items: [{ trace_id: 'real-trace', name: 'Actual run', start_time_ms: Date.now(), duration_ms: 900, span_count: 4, has_error: false, total_cost_usd: 2 }],
    });
    const { setView, setSelected } = show('customer-42');
    fireEvent.click(await screen.findByRole('button', { name: /Actual run/ }));
    expect(setView).toHaveBeenCalledWith('trace');
    expect(setSelected.mock.calls[0][0]({}).traceId).toBe('real-trace');
  });

  it('opens a workflow from the breakdown', async () => {
    api.getKpis.mockResolvedValue(kpis(12, 8));
    api.getWorkflowUsage.mockResolvedValue({
      ...empty,
      items: [{ name: 'summarize', model: 'gpt-4o', cost: 3, cost_prev: 1, runs: 5, runs_prev: 2 }],
    });
    const { setView, setSelected } = show('customer-42');
    fireEvent.click(await screen.findByText('summarize'));
    expect(setView).toHaveBeenCalledWith('workflows');
    expect(setSelected.mock.calls[0][0]({}).workflow).toBe('summarize');
  });

  it('reports API failure without showing invented usage', async () => {
    api.getKpis.mockRejectedValue(new Error('offline'));
    show('offline-user');
    expect(await screen.findByText('Failed to load')).toBeInTheDocument();
    expect(screen.queryByText('Spend')).not.toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowDetailLivePage } from './WorkflowDetailLivePage';

const api = vi.hoisted(() => ({
  getWorkflowDetail: vi.fn(),
  getCostSeries: vi.fn(),
  getLatencySeries: vi.fn(),
  getErrorSeries: vi.fn(),
  listTraces: vi.fn(),
}));
vi.mock('../../../common/providers/APIProvider', () => ({
  useAPIClient: () => ({
    metricsAPI: {
      getWorkflowDetail: api.getWorkflowDetail,
      getCostSeries: api.getCostSeries,
      getLatencySeries: api.getLatencySeries,
      getErrorSeries: api.getErrorSeries,
    },
    tracesAPI: { listTraces: api.listTraces },
  }),
}));

const empty = { items: [], total: 0, page: 1, page_size: 20 };

function show(range = '7d') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (r: string) => (
    <QueryClientProvider client={client}>
      <WorkflowDetailLivePage workflowName="checkout" range={r} setView={vi.fn()} setSelected={vi.fn()} />
    </QueryClientProvider>
  );
  const { rerender } = render(page(range));
  return (r: string) => rerender(page(r));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  api.getWorkflowDetail.mockResolvedValue({
    name: 'checkout', calls: 100, cost: 1, avg_latency_ms: 900, p95_latency_ms: 1500, error_rate: 0.13,
    input_tokens: 0, output_tokens: 0, model: 'gpt-4o', provider: '', tools: [], last_trace_id: '',
  });
  api.getCostSeries.mockResolvedValue(empty);
  api.getLatencySeries.mockResolvedValue(empty);
  api.getErrorSeries.mockResolvedValue(empty);
  api.listTraces.mockResolvedValue(empty);
});

afterEach(() => vi.unstubAllGlobals());

describe('live workflow detail', () => {
  it('reports the same failure count in the stat and the reliability header', async () => {
    show();
    expect(await screen.findByText('13 failures')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument();
  });

  it('marks only the panel whose request failed', async () => {
    api.getCostSeries.mockRejectedValue(new Error('boom'));
    show();
    expect(await screen.findByText("Couldn't load spend")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load latency")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load runs")).not.toBeInTheDocument();
  });

  it('keeps the page up while a new range loads', async () => {
    const setRange = show('7d');
    await screen.findByText('13 failures');
    api.getWorkflowDetail.mockReturnValue(new Promise(() => {}));
    setRange('30d');
    expect(screen.getByText('13 failures')).toBeInTheDocument();
  });
});

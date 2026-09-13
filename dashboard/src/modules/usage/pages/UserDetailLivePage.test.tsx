import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { UserDetailLivePage } from './UserDetailLivePage';

const api = vi.hoisted(() => ({ getUserUsage: vi.fn(), listTraces: vi.fn() }));
vi.mock('../../../common/providers/APIProvider', () => ({
  useAPIClient: () => ({ metricsAPI: { getUserUsage: api.getUserUsage }, tracesAPI: { listTraces: api.listTraces } }),
}));

function show(userId: string) {
  const setView = vi.fn();
  const setSelected = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><UserDetailLivePage userId={userId} range="7d" setView={setView} setSelected={setSelected} /></QueryClientProvider>);
  return { setView, setSelected };
}

describe('live user details', () => {
  it('shows no fabricated fallback when the user has no usage', async () => {
    api.getUserUsage.mockResolvedValue({ items: [{ user_id: 'another-user', cost: 999, runs: 1 }] });
    api.listTraces.mockResolvedValue({ items: [] });
    show('missing-user');
    expect(await screen.findByText('No usage found')).toBeInTheDocument();
    expect(screen.queryByText('another-user')).not.toBeInTheDocument();
    expect(screen.queryByText('Usage by workflow')).not.toBeInTheDocument();
  });

  it('loads the selected user and opens an actual returned trace', async () => {
    api.getUserUsage.mockResolvedValue({ items: [{ user_id: 'customer-42', cost: 12, runs: 8 }] });
    api.listTraces.mockResolvedValue({ items: [{ trace_id: 'real-trace', name: 'Actual run', total_cost_usd: 2 }] });
    const { setView, setSelected } = show('customer-42');
    fireEvent.click(await screen.findByRole('button', { name: /Actual run/ }));
    expect(api.getUserUsage).toHaveBeenCalledWith('7d', 'customer-42');
    expect(api.listTraces).toHaveBeenCalledWith({ user_id: 'customer-42', range: '7d', page_size: 20 });
    expect(setView).toHaveBeenCalledWith('trace');
    expect(setSelected.mock.calls[0][0]({}).traceId).toBe('real-trace');
  });

  it('reports API failure without showing invented usage', async () => {
    api.getUserUsage.mockRejectedValue(new Error('offline'));
    api.listTraces.mockResolvedValue({ items: [] });
    show('offline-user');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load user usage.'));
  });
});

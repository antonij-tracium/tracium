import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowsPage } from './WorkflowsPage';
import { WORKFLOWS } from '../data';

describe('WorkflowsPage', () => {
  it('labels the trend with the selected range and counts workflows in the singular', () => {
    render(<WorkflowsPage workflows={WORKFLOWS.slice(0, 1)} range="24h" setView={vi.fn()} setSelected={vi.fn()} />);
    expect(screen.getByText('Trend · last 24 hours')).toBeInTheDocument();
    expect(screen.getByText(/^1 active workflow ·/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Filter workflows' })).toBeInTheDocument();
  });

  it('exposes the sort column and direction', () => {
    render(<WorkflowsPage workflows={WORKFLOWS} setView={vi.fn()} setSelected={vi.fn()} />);
    const header = (name: string) => screen.getByRole('button', { name }).closest('[role="columnheader"]');
    expect(header('Calls')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Cost')).toHaveAttribute('aria-sort', 'none');

    fireEvent.click(screen.getByRole('button', { name: 'Calls' }));
    expect(header('Calls')).toHaveAttribute('aria-sort', 'ascending');
  });
});

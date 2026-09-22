import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './SettingsPage';
import type { Workspace } from '../../shell/interfaces';
import { APIError } from '../../../common/api';

// AccountView's password-change field reads usersAPI from context; the
// 'workspace setup' tests exercise workspace setup, not the API client, so a
// mock is enough there. The 'change password' tests below override it per case.
const changePassword = vi.fn();
vi.mock('../../../common/providers/APIProvider', () => ({
  useAPIClient: () => ({ usersAPI: { changePassword } }),
}));

const workspace: Workspace = {
  id: 'ws_generated_123' as Workspace['id'], name: 'Acme Production',
  slug: 'acme-production', env: 'production', role: 'Owner', members: 1,
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Flow({ create }: { create: () => Promise<Workspace> }) {
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [createMode, setCreateMode] = useState(true);
  return <SettingsPage workspace={selected} createMode={createMode} onCancelCreate={() => setCreateMode(false)} createWorkspace={async () => {
    const result = await create();
    setSelected(result);
    setCreateMode(false);
    return result;
  }} />;
}

describe('workspace setup', () => {
  it('explains the ID before creation and shows the server-generated ID after success', async () => {
    const create = vi.fn().mockResolvedValue(workspace);
    render(<Flow create={create} />);
    expect(screen.getByText(/Tracium generates a separate workspace ID/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Workspace name' }), { target: { value: workspace.name } });
    expect(screen.getByRole('textbox', { name: 'Slug' })).toHaveValue(workspace.slug);
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace & continue' }));
    expect(await screen.findByRole('heading', { name: 'Connect your application' })).toHaveFocus();
    expect(screen.getByText(workspace.id)).toBeInTheDocument();
    expect(screen.getByText(/created · Step 2 of 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy workspace ID' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(workspace.id));
    fireEvent.click(screen.getByRole('button', { name: 'Copy configuration' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`OTEL_RESOURCE_ATTRIBUTES="tracium.workspace.id=${workspace.id}"`));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate submissions and preserves details after a failure', async () => {
    let reject!: (error: Error) => void;
    const create = vi.fn(() => new Promise<Workspace>((_, fail) => { reject = fail; }));
    render(<Flow create={create} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Workspace name' }), { target: { value: workspace.name } });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace & continue' }));
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('textbox', { name: 'Workspace name' }).closest('form')!);
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('Workspace slug already exists.')));
    expect(screen.getByRole('alert')).toHaveTextContent('Workspace slug already exists.');
    expect(screen.getByRole('textbox', { name: 'Workspace name' })).toHaveValue(workspace.name);
    expect(screen.getByRole('button', { name: 'Create workspace & continue' })).toBeEnabled();
  });

  it('keeps setup available later and updates copied values when switching workspaces', async () => {
    const overview = vi.fn();
    const { rerender } = render(<SettingsPage workspace={workspace} onOpenOverview={overview} />);
    expect(screen.getByRole('heading', { name: 'Connect your application' })).toBeInTheDocument();
    expect(screen.queryByText(/created · Step 2/)).not.toBeInTheDocument();
    const other = { ...workspace, id: 'ws_other' as Workspace['id'], name: 'Staging' };
    rerender(<SettingsPage workspace={other} onOpenOverview={overview} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy workspace ID' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ws_other'));
    expect(screen.queryByText(workspace.id)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go to overview' }));
    expect(overview).toHaveBeenCalledOnce();
  });

  it('offers manual copying when clipboard access fails', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('Permission denied'));
    render(<SettingsPage workspace={workspace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy workspace ID' }));
    expect(await screen.findByText('Couldn’t copy. Select and copy the text manually.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
    expect(screen.getByText(workspace.id)).toBeInTheDocument();
  });

  it('uses the same copy feedback for the compact demo workspace control', async () => {
    render(<SettingsPage demo />);
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ws_2qHv4Rt81xLpKnvR');
    expect(screen.getByRole('status')).toHaveTextContent('workspace ID copied to clipboard.');

    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('Permission denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Copied' }));
    expect(await screen.findByRole('button', { name: 'Copy manually' })).toHaveAttribute('title', 'Couldn’t copy. Select and copy the text manually.');
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t copy. Select and copy the text manually.');
  });

  it('opens creation when requested while Settings is already mounted', () => {
    const create = vi.fn().mockResolvedValue(workspace);
    const { rerender } = render(<SettingsPage workspace={workspace} createWorkspace={create} />);
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    rerender(<SettingsPage workspace={workspace} createWorkspace={create} createMode />);
    expect(screen.getByRole('heading', { name: 'Create workspace' })).toBeInTheDocument();
  });
});

describe('change password', () => {
  beforeEach(() => {
    changePassword.mockReset();
  });

  function openForm() {
    render(<SettingsPage workspace={workspace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
  }

  it('submits the current and new password and shows confirmation', async () => {
    changePassword.mockResolvedValue(undefined);
    openForm();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-pass' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('old-pass', 'new-password'));
    expect(await screen.findByText('Password updated.')).toBeInTheDocument();
  });

  it('rejects a mismatched confirmation without calling the API', () => {
    openForm();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-pass' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'something-else' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(screen.getByRole('alert')).toHaveTextContent("New passwords don't match.");
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('surfaces the API error message (e.g. wrong current password)', async () => {
    changePassword.mockRejectedValue(new APIError('Current password is incorrect', 401, 'INVALID_CURRENT_PASSWORD'));
    openForm();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect');
  });
});

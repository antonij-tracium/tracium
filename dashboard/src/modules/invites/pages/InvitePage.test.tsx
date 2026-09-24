import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InvitePage from './InvitePage';

const TOKEN = 'trci_' + 'a'.repeat(64);
const preview = {
  workspace_name: 'Acme Production',
  invited_by_email: 'owner@acme.dev',
  email: 'bob@acme.dev',
  expires_at: '2026-10-01T00:00:00Z',
};

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((url: string) => url.endsWith('/accept')
    ? respond(200, { workspace_id: 'ws-1' })
    : respond(200, preview));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderPage(props: Partial<React.ComponentProps<typeof InvitePage>> = {}) {
  return render(<MemoryRouter><InvitePage token={TOKEN} session={null} {...props} /></MemoryRouter>);
}

describe('InvitePage', () => {
  it('asks a signed-out visitor to sign in with the invited email', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Join Acme Production' })).toBeInTheDocument();
    expect(screen.getByText(/owner@acme.dev invited bob@acme.dev/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/signup');
    expect(screen.queryByRole('button', { name: 'Accept invite' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/v1/invites/${TOKEN}`), expect.anything());
  });

  it('accepts for the invited account', async () => {
    const onAccepted = vi.fn();
    renderPage({ session: { token: 'jwt', email: 'Bob@acme.dev' }, onAccepted });
    fireEvent.click(await screen.findByRole('button', { name: 'Accept invite' }));
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith('ws-1'));
    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/accept'))!;
    expect(url).toContain(`/v1/invites/${TOKEN}/accept`);
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer jwt' } });
  });

  it('tells a different signed-in account to switch instead of accepting', async () => {
    const onSignOut = vi.fn();
    renderPage({ session: { token: 'jwt', email: 'eve@acme.dev' }, onSignOut });
    expect(await screen.findByRole('alert')).toHaveTextContent(/signed in as eve@acme.dev, but this invite is for bob@acme.dev/);
    expect(screen.queryByRole('button', { name: 'Accept invite' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('explains an expired or used invite', async () => {
    fetchMock.mockImplementation(() => respond(410, { code: 'INVITE_EXPIRED', message: 'gone' }));
    const onDismiss = vi.fn();
    renderPage({ session: { token: 'jwt', email: 'bob@acme.dev' }, onDismiss });
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired or was already used/);
    fireEvent.click(screen.getByRole('button', { name: 'Go to dashboard' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('shows the server refusal when accepting fails', async () => {
    fetchMock.mockImplementation((url: string) => url.endsWith('/accept')
      ? respond(403, { code: 'INVITE_EMAIL_MISMATCH', message: 'nope' })
      : respond(200, preview));
    const onAccepted = vi.fn();
    renderPage({ session: { token: 'jwt', email: 'bob@acme.dev' }, onAccepted });
    fireEvent.click(await screen.findByRole('button', { name: 'Accept invite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/sent to a different email address/);
    expect(onAccepted).not.toHaveBeenCalled();
  });
});

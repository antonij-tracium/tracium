import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen} from '@testing-library/react';
import App from './App';

Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockImplementation(query => ({matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn()})) });

describe('App logged-out routing', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  it('renders no extra routes by default (self-hosted has no forgot-password page)', () => {
    window.history.pushState({}, '', '/forgot-password');
    render(<App />);
    // No matching route: falls through to the logged-out catch-all (redirects to login).
    expect(screen.queryByText('Custom auth route')).toBeNull();
  });

  it('renders an authRoutes entry supplied via extensions', () => {
    window.history.pushState({}, '', '/forgot-password');
    render(<App extensions={{ authRoutes: [{ path: '/forgot-password', element: <div>Custom auth route</div> }] }} />);
    expect(screen.getByText('Custom auth route')).toBeTruthy();
  });
});

describe('App invite links', () => {
  const token = 'trci_' + 'b'.repeat(64);
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      workspace_name: 'Acme', invited_by_email: 'owner@acme.dev', email: 'bob@acme.dev', expires_at: '2026-10-01T00:00:00Z',
    }), { status: 200 }))));
  });

  it('shows the invite to a signed-out visitor', async () => {
    window.history.pushState({}, '', `/invite/${token}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Join Acme' })).toBeTruthy();
    expect(localStorage.getItem('tracium_invite')).toBe(token);
  });

  it('resumes a remembered invite after sign-in instead of opening the dashboard', async () => {
    localStorage.setItem('tracium_invite', token);
    localStorage.setItem('tracium_token', 'jwt');
    localStorage.setItem('tracium_email', 'bob@acme.dev');
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Accept invite' })).toBeTruthy();
  });
});

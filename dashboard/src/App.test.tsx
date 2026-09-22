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

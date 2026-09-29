import {describe,it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import LoginPage from './LoginPage';

Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockImplementation(query => ({matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn()})) });

describe('LoginPage', () => {
  it('hides the forgot-password link when no extension supplies one (self-hosted)', () => {
    render(<MemoryRouter><LoginPage onLogin={vi.fn()} /></MemoryRouter>);
    expect(screen.queryByText('Forgot password?')).toBeNull();
  });

  it('shows the forgot-password link pointing at the extension-supplied href', () => {
    render(
      <MemoryRouter>
        <LoginPage onLogin={vi.fn()} appearance={{ forgotPasswordHref: '/forgot-password' }} />
      </MemoryRouter>,
    );
    const link = screen.getByText('Forgot password?').closest('a');
    expect(link?.getAttribute('href')).toBe('/forgot-password');
  });

  it('renders extension sign-in options above the form with the page mode', () => {
    const Options = ({ mode }: { mode: 'signin' | 'signup' }) => <button type="button">external {mode}</button>;
    render(<MemoryRouter><LoginPage onLogin={vi.fn()} appearance={{ signInOptions: Options }} /></MemoryRouter>);
    const button = screen.getByText('external signin');
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect(button.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

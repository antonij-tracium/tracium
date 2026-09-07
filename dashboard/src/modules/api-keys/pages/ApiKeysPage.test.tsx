import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import ApiKeysPage from './ApiKeysPage';

it('does not offer simulated credentials to signed-in users', () => {
  render(<ApiKeysPage />);
  expect(screen.getByText(/No keys can be created or revoked here/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /create|revoke/i })).not.toBeInTheDocument();
});

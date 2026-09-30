import { describe, it, expect } from 'vitest';
import { stateToPath, pathToState } from './routing';

describe('clients routing', () => {
  it('builds /clients paths for the clients list and detail', () => {
    expect(stateToPath('users', {})).toBe('/clients');
    expect(stateToPath('user', { user: 'acme corp' })).toBe('/clients/acme%20corp');
  });

  it('parses /clients and legacy /users links to the same views', () => {
    for (const base of ['/clients', '/users']) {
      expect(pathToState(base)).toEqual({ view: 'users', selected: {} });
      expect(pathToState(`${base}/acme%20corp`)).toEqual({ view: 'user', selected: { user: 'acme corp' } });
    }
  });
});

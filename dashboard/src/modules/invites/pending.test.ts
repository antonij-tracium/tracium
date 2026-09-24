import { beforeEach, describe, expect, it } from 'vitest';
import { INVITE_KEY, clearPendingInvite, inviteTokenFromPath, readPendingInvite } from './pending';

describe('pending invite', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  it('parses the token from an invite path only', () => {
    expect(inviteTokenFromPath('/invite/trci_abc')).toBe('trci_abc');
    expect(inviteTokenFromPath('/invite/trci_abc/')).toBe('trci_abc');
    expect(inviteTokenFromPath('/invite/')).toBeNull();
    expect(inviteTokenFromPath('/invite/a/b')).toBeNull();
    expect(inviteTokenFromPath('/traces/abc')).toBeNull();
  });

  it('remembers an invite from the URL across sign-in', () => {
    window.history.pushState({}, '', '/invite/trci_abc');
    expect(readPendingInvite()).toBe('trci_abc');
    window.history.pushState({}, '', '/login');
    expect(readPendingInvite()).toBe('trci_abc');
    clearPendingInvite();
    expect(readPendingInvite()).toBeNull();
    expect(localStorage.getItem(INVITE_KEY)).toBeNull();
  });
});

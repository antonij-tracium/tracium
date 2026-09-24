// localStorage, not sessionStorage, so the invite survives an email-confirmation
// link opened in a new tab.
export const INVITE_KEY = 'tracium_invite';

const INVITE_PATH = /^\/invite\/([^/]+)\/?$/;

export function inviteTokenFromPath(pathname: string): string | null {
  const match = INVITE_PATH.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function readPendingInvite(): string | null {
  const fromPath = inviteTokenFromPath(window.location.pathname);
  try {
    if (fromPath) {
      localStorage.setItem(INVITE_KEY, fromPath);
      return fromPath;
    }
    return localStorage.getItem(INVITE_KEY);
  } catch {
    return fromPath;
  }
}

export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(INVITE_KEY);
  } catch {
    // Storage unavailable; nothing was remembered.
  }
}

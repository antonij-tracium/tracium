// An invite link (/invite/<token>) may be opened while signed out. The token is
// kept in localStorage — not sessionStorage — so it survives the detour through
// sign-up, including a hosted email-confirmation link that opens in a new tab.
// It is cleared once the invite is accepted or dismissed.
export const INVITE_KEY = 'tracium_invite';

const INVITE_PATH = /^\/invite\/([^/]+)\/?$/;

/** The invite token in an /invite/<token> pathname, or null. */
export function inviteTokenFromPath(pathname: string): string | null {
  const match = INVITE_PATH.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * The invite to resolve on this load: one in the current URL (which is
 * remembered for after sign-in), else one remembered from an earlier visit.
 */
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

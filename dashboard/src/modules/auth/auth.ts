export const TOKEN_KEY = 'tracium_token';
export const EMAIL_KEY = 'tracium_email';
// Where a deep link is stashed when a logged-out visitor opens one, so they can
// be sent back to it after authenticating (see App.tsx and the dashboard's
// initial-view resolution).
export const REDIRECT_KEY = 'tracium_redirect';

export function readInitialToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    localStorage.setItem(TOKEN_KEY, urlToken);
    window.history.replaceState({}, '', window.location.pathname);
    return urlToken;
  }
  return localStorage.getItem(TOKEN_KEY);
}

export interface Account {
  email: string;
  name: string;
  initials: string;
}

/**
 * Derives a display identity from the sign-in email — the only real account
 * detail we hold. "ada.lovelace@x.io" → name "Ada Lovelace", initials "AL".
 */
export function accountFromEmail(email: string): Account {
  const local = email.split('@')[0] ?? '';
  const words = local.split(/[._-]+/).filter(Boolean);
  const name = words.length
    ? words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : email;
  const initials = (words.length >= 2
    ? words[0].charAt(0) + words[1].charAt(0)
    : local.slice(0, 2)
  ).toUpperCase() || '—';
  return { email, name, initials };
}

export function readAccount(): Account | null {
  const email = localStorage.getItem(EMAIL_KEY);
  return email ? accountFromEmail(email) : null;
}

import type { ViewId } from './ids';

/**
 * Bidirectional mapping between the dashboard's in-memory navigation state
 * (a `view` plus a `selected` record holding the active entity id) and a real
 * URL pathname. This is what makes pages linkable: a user can copy the address
 * bar for a trace/user/agent and send it to someone, and the recipient lands
 * on the same page.
 *
 * Detail entity ids (trace id, user id, agent name) can contain characters
 * that are unsafe in a path segment, so they are percent-encoded here and
 * decoded on the way back.
 */

export interface NavState {
  view: ViewId;
  selected: Record<string, string>;
}

/** Build the URL pathname for a given navigation state. */
export function stateToPath(view: ViewId, selected: Record<string, string>): string {
  const enc = (v: string) => encodeURIComponent(v);
  switch (view) {
    case 'overview':   return '/';
    case 'agents':     return selected.agent ? `/agents/${enc(selected.agent)}` : '/agents';
    case 'trace':      return selected.traceId ? `/traces/${enc(selected.traceId)}` : '/traces';
    case 'usage':      return '/usage';
    case 'users':    return '/users';
    case 'user':     return selected.user ? `/users/${enc(selected.user)}` : '/users';
    case 'keys':       return '/api-keys';
    case 'settings':   return '/settings';
    default:           return '/';
  }
}

/**
 * Parse a URL pathname back into navigation state. Returns null for paths that
 * don't correspond to a known view, so callers can fall back to a default.
 */
export function pathToState(pathname: string): NavState | null {
  const seg = pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (seg.length === 0) return { view: 'overview', selected: {} };

  switch (seg[0]) {
    case 'agents':
      return seg[1]
        ? { view: 'agents', selected: { agent: seg[1] } }
        : { view: 'agents', selected: {} };
    case 'traces':
      return seg[1]
        ? { view: 'trace', selected: { traceId: seg[1] } }
        : { view: 'trace', selected: {} };
    case 'usage':
      return { view: 'usage', selected: {} };
    case 'users':
      return seg[1]
        ? { view: 'user', selected: { user: seg[1] } }
        : { view: 'users', selected: {} };
    case 'api-keys':
      return { view: 'keys', selected: {} };
    case 'settings':
      return { view: 'settings', selected: {} };
    default:
      return null;
  }
}

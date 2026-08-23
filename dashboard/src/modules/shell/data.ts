import type { Workspace, Tweaks } from './interfaces';
import type { WorkspaceId } from './ids';
import { TOKEN_KEY } from '../auth/auth';

const WORKSPACES_KEY_PREFIX = 'tracium_workspaces';

/**
 * Workspaces are stored per account (keyed by the auth token). A real
 * signed-in account starts with an empty list and no demo data — the user
 * creates their own first workspace. The "Demo" workspace (and the demo data
 * it surfaces) is reserved for the logged-out auth-page preview, which builds
 * it directly via {@link createDemoWorkspace} in embedded mode and never calls
 * {@link loadWorkspaces}.
 */
function storageKey(): string {
  const token = localStorage.getItem(TOKEN_KEY) ?? 'anon';
  return `${WORKSPACES_KEY_PREFIX}:${token}`;
}

export function createDemoWorkspace(): Workspace {
  return {
    id: `demo-${Math.random().toString(36).slice(2, 10)}` as WorkspaceId,
    name: 'Demo',
    slug: 'demo',
    role: 'Owner',
    members: 1,
    plan: 'Free',
    env: 'production',
  };
}

export function saveWorkspaces(workspaces: Workspace[]): void {
  localStorage.setItem(storageKey(), JSON.stringify(workspaces));
}

/**
 * Loads the current account's workspaces. A brand-new account starts with an
 * empty list — no demo workspace or demo data is seeded. Workspaces only exist
 * once the user creates them.
 */
export function loadWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw !== null) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as Workspace[];
    }
  } catch {
    /* fall through to the empty default */
  }

  return [];
}

export const TWEAK_DEFAULTS: Tweaks = {
  feedPosition: 'right',
};

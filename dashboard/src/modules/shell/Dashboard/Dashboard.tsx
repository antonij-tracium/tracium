import { EMPTY_EXTENSIONS, validateExtensions, type DashboardExtensions, type ExtensionPage } from '../../../extensions';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useAPIClient } from '../../../common/providers/APIProvider';
import { Sidebar } from '../Sidebar';
import { TopBar } from '../TopBar';
import { CommandPalette } from '../CommandPalette';
import { OverviewPage, OverviewLivePage } from '../../overview';
import { WorkflowsPage, WorkflowsLivePage, WorkflowDetailDemoPage, WorkflowDetailLivePage, WORKFLOWS } from '../../workflows';
import { TraceDetailDashPage, TRACE_DETAIL } from '../../trace-inspector';
import { TraceDetailView } from '../../trace-explorer';
import { UsersPage, UsersLivePage, UserDetailPage, UsagePage, UsageLivePage, USERS } from '../../usage';
import { UserDetailLivePage } from '../../usage/pages/UserDetailLivePage';
import { ApiKeysPage } from '../../api-keys';
import { SettingsPage } from '../../settings';
import { EmptyState, useMaxWidth, BREAKPOINTS } from '../../../common';
import { readAccount } from '../../auth';
import { createDemoWorkspace, TWEAK_DEFAULTS } from '../data';
import { useWorkspaces } from '../hooks/useWorkspaces';
import type { Workspace, BreadcrumbItem, CommandAction } from '../interfaces';
import type { ViewId } from '../ids';
import { stateToPath, pathToState, type NavState } from '../routing';
import { REDIRECT_KEY } from '../../auth';

export interface DashboardProps {
  extensions?: DashboardExtensions;
  /**
   * When true, the dashboard renders as a contained, interactive product
   * preview (e.g. inside the auth screen). It fits its parent container
   * instead of the viewport and keeps all state in memory, so a logged-out
   * visitor clicking around the preview never touches the real app's
   * persisted state.
   */
  embedded?: boolean;
  /**
   * Logs the current account out. Omitted in embedded mode (the auth preview
   * has no real session), so the Sidebar hides its logout control there.
   */
  onLogout?: () => void;
}

/**
 * Demo data (KPIs, workflows, traces, usage…) exists only to bring the logged-out
 * auth-page preview to life. A real signed-in workspace starts empty until it
 * receives its own data, so these data views render an empty state instead.
 * Keyed by ViewId; views not listed here (settings, keys, detail
 * views) are either functional or unreachable from an empty workspace. Overview,
 * workflows and usage are also absent: OverviewLivePage / WorkflowsLivePage /
 * UsageLivePage fetch real metrics and render their own empty state when there
 * are no runs yet.
 */
const DATA_EMPTY: Partial<Record<ViewId, { message: string; description: string }>> = {
  // Users now renders UsersLivePage, which fetches real metrics and shows
  // its own "No users yet" empty state when the window has no activity.
};

/**
 * Shown to a real signed-in account that has no workspace yet. New accounts
 * start empty (no demo workspace or demo data), so this prompts the user to
 * create their first workspace. It never appears in the embedded auth preview,
 * which is always seeded with a Demo workspace.
 */
function WorkspaceEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 14,
        minHeight: '60vh',
        padding: '40px 24px',
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--foreground)', margin: 0 }}>
        Create your first workspace
      </h2>
      <p style={{ fontSize: 13.5, color: 'var(--muted)', maxWidth: 420, margin: 0, lineHeight: 1.5 }}>
        Workspaces hold your workflows, traces, and usage. Create one to start
        sending data to Tracium.
      </p>
      <button
        onClick={onCreate}
        style={{
          marginTop: 4,
          padding: '9px 18px',
          borderRadius: 8,
          background: 'var(--accent)',
          color: 'var(--accent-contrast)',
          border: 'none',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Create workspace
      </button>
    </div>
  );
}

/**
 * Resolve the navigation state the dashboard should open on. See the call site
 * for the precedence rationale. Reads from the URL / storage once at mount.
 */
function computeInitialNav(persist: boolean, pages: readonly ExtensionPage[]): NavState {
  if (!persist) return { view: 'overview', selected: {} };

  const fromUrl = pathToState(window.location.pathname, pages);
  if (fromUrl) return fromUrl;

  // Peek only — this runs during render, so it must be idempotent. The stash
  // is cleared in the history-init effect once the dashboard is mounted.
  const redirect = sessionStorage.getItem(REDIRECT_KEY);
  if (redirect) {
    const fromRedirect = pathToState(redirect, pages);
    if (fromRedirect) return fromRedirect;
  }

  const stored = localStorage.getItem('tracium_view') as ViewId | null;
  const valid = stored && (pages.some(p => p.id === stored) || ['overview','workflows','trace','usage','keys','settings','users','user'].includes(stored));
  return { view: valid ? stored : 'overview', selected: {} };
}

export function Dashboard({ embedded = false, onLogout, extensions = EMPTY_EXTENSIONS }: DashboardProps = {}) {
  validateExtensions(extensions);
  const pages = extensions.pages ?? [];
  const persist = !embedded;

  // Initial page comes from the URL so deep links open the right view. Order:
  // (1) the current path (a logged-in user opening a shared link), (2) a path
  // stashed before the login redirect (a logged-out recipient of a shared
  // link, see App.tsx), then (3) the last-visited view from localStorage. The
  // embedded auth preview is never URL-driven. Computed once via a ref.
  const initialNavRef = useRef<NavState | null>(null);
  if (initialNavRef.current === null) {
    initialNavRef.current = computeInitialNav(persist, pages);
  }
  const initialNav = initialNavRef.current;

  const [view, setViewRaw] = useState<ViewId>(initialNav.view);
  const [range, setRangeRaw] = useState(
    () => (persist ? localStorage.getItem('tracium_range') : null) ?? '7d',
  );
  const [selected, setSelected] = useState<Record<string, string>>(initialNav.selected);

  const demoWorkspace = useMemo(() => createDemoWorkspace(), []);
  const { workspaces: serverWorkspaces, isLoading: wsLoading, createWorkspace: apiCreate, deleteWorkspace: apiDelete } =
    useWorkspaces(persist);
  const workspaces: Workspace[] = persist ? serverWorkspaces : [demoWorkspace];

  const [workspace, setWorkspace] = useState<Workspace | null>(() =>
    persist ? null : demoWorkspace,
  );
  const wsInitialized = useRef(false);
  useEffect(() => {
    if (!persist || wsInitialized.current || wsLoading) return;
    wsInitialized.current = true;
    const id = localStorage.getItem('tracium_ws');
    setWorkspace(serverWorkspaces.find((w) => w.id === id) ?? serverWorkspaces[0] ?? null);
  }, [persist, wsLoading, serverWorkspaces]);

  // Scope every API read to the active workspace: point the API clients at the
  // new workspace_id when the selection changes (or resolves on load). The data
  // hooks fold workspaceId into their query keys, so changing it refetches every
  // dashboard on its own, scoped to the rebuilt client — no manual invalidation
  // (which would race the client rebuild and refetch with the stale, unscoped
  // client). Only in the real app — the embedded preview renders demo data and
  // makes no live reads.
  const { setWorkspaceId } = useAPIClient();
  useEffect(() => {
    if (!persist) return;
    setWorkspaceId(workspace?.id);
  }, [persist, workspace?.id, setWorkspaceId]);
  const [cmdOpen, setCmdOpen] = useState(false);
  // Below this width the sidebar collapses into an off-canvas drawer. The
  // embedded auth preview is never shown at mobile widths, so it keeps the
  // static sidebar regardless.
  const isMobileNav = useMaxWidth(BREAKPOINTS.mobile) && !embedded;
  const [navOpen, setNavOpen] = useState(false);
  // Set when the user clicks "Create workspace" — routes them to the Settings
  // page opened on a create-workspace form. Cleared on any other navigation.
  const [createWsIntent, setCreateWsIntent] = useState(false);

  const setView = (v: string) => {
    setViewRaw(v as ViewId);
    if (v !== 'settings') setCreateWsIntent(false);
    if (persist) localStorage.setItem('tracium_view', v);
  };
  const setRange = (r: string) => {
    setRangeRaw(r);
    if (persist) localStorage.setItem('tracium_range', r);
  };
  const updateWorkspace = (ws: Workspace) => {
    setWorkspace(ws);
    if (persist) localStorage.setItem('tracium_ws', ws.id);
  };
  const goCreateWorkspace = () => {
    setCreateWsIntent(true);
    setView('settings');
  };
  const createWorkspace = async (input: { name: string; slug: string; env: Workspace['env'] }) => {
    if (!persist) throw new Error('Sign in to create a workspace.');
    const ws = await apiCreate(input);
    updateWorkspace(ws);
    setCreateWsIntent(false);
    return ws;
  };
  const deleteWorkspace = async (id: string) => {
    if (!persist) return;
    const fallback = workspaces.find((w) => w.id !== id) ?? null;
    await apiDelete(id);
    if (workspace?.id === id) {
      setWorkspace(fallback);
      if (persist) {
        if (fallback) localStorage.setItem('tracium_ws', fallback.id);
        else localStorage.removeItem('tracium_ws');
      }
    }
  };

  useEffect(() => {
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [embedded]);

  // Browser history + URL integration. Navigation is state-driven, so without
  // this (a) the Back button has no in-app entries to return to and would leave
  // Tracium, and (b) the address bar never changes, so pages aren't linkable.
  // We mirror each (view, selected) change onto the history stack with a real
  // pathname (see routing.ts), so Back/Forward move between views and the URL
  // can be copied and shared. Only in the real app — the embedded auth preview
  // must never touch the global history or URL.
  //
  // popRef guards the push effect from re-pushing when a popstate event is the
  // one that changed the state; histInit ensures the very first view replaces
  // the current entry instead of pushing a redundant one.
  const popRef = useRef(false);
  const histInit = useRef(false);

  useEffect(() => {
    if (!persist) return;
    if (popRef.current) {
      popRef.current = false;
      return;
    }
    const entry = { tracium: true, view, selected };
    const path = stateToPath(view, selected, pages);
    if (!histInit.current) {
      histInit.current = true;
      // A deep link stashed before login has now been applied to the initial
      // view; drop it so it can't override a later in-app navigation.
      sessionStorage.removeItem(REDIRECT_KEY);
      window.history.replaceState(entry, '', path);
    } else {
      window.history.pushState(entry, '', path);
    }
  }, [view, selected, persist]);

  useEffect(() => {
    if (!persist) return;
    const onPop = (e: PopStateEvent) => {
      let s = e.state as { tracium?: boolean; view?: ViewId; selected?: Record<string, string> } | null;
      // History entries we created carry our marker; for anything else (e.g.
      // the user manually editing the URL) fall back to parsing the path.
      if (!s?.tracium || !s.view) {
        const parsed = pathToState(window.location.pathname, pages);
        if (!parsed) return;
        s = { tracium: true, view: parsed.view, selected: parsed.selected };
      }
      popRef.current = true;
      setViewRaw(s.view!);
      setSelected(s.selected ?? {});
      localStorage.setItem('tracium_view', s.view!);
      if (s.view !== 'settings') setCreateWsIntent(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [persist]);

  const breadcrumb = useMemo((): BreadcrumbItem[] => {
    const page = pages.find(p => p.id === view);
    if (page) return [{ label: page.label }];
    if (view === 'trace')      return [{ label: 'Overview', onClick: () => setView('overview') }, { label: selected.traceId ?? TRACE_DETAIL.id }];
    if (view === 'workflows')     return selected.workflow
      ? [{ label: 'Workflows', onClick: () => { setSelected(s => { const n = { ...s }; delete n.workflow; return n; }); setView('workflows'); } }, { label: selected.workflow }]
      : [{ label: 'Workflows' }];
    if (view === 'usage')      return [{ label: 'Usage' }];
    if (view === 'users')    return [{ label: 'Users' }];
    if (view === 'user')     return [{ label: 'Users', onClick: () => setView('users') }, { label: 'User detail' }];
    if (view === 'keys')       return [{ label: 'Settings', onClick: () => setView('settings') }, { label: 'API Keys' }];
    if (view === 'settings')   return [{ label: 'Settings' }];
    return [{ label: 'Overview' }];
  }, [view, selected.traceId, selected.workflow]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCommandSelect = (action: CommandAction | undefined) => {
    if (!action) return;
    if (action.view === 'trace') {
      if (action.trace) setSelected(s => ({ ...s, traceId: action.trace! }));
      setView('trace');
      return;
    }
    if (action.view === 'workflow-detail') {
      if (action.workflow) setSelected(s => ({ ...s, workflow: action.workflow! }));
      setView('workflows');
      return;
    }
    if (action.view) setView(action.view);
  };

  const activePage = pages.find(p => p.id === view);
  const Page = activePage?.component;
  return (
    <div
      style={{
        display: 'flex',
        background: 'var(--background)',
        ...(embedded
          ? { height: '100%', overflow: 'hidden' }
          : { minHeight: '100vh' }),
      }}
    >
      <Sidebar
        items={pages}
        currentView={view}
        setView={setView}
        workspace={workspace}
        workspaces={workspaces}
        setWorkspace={updateWorkspace}
        createWorkspace={goCreateWorkspace}
        deleteWorkspace={deleteWorkspace}
        embedded={embedded}
        onLogout={onLogout}
        mobile={isMobileNav}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          ...(embedded ? { minHeight: 0, overflow: 'hidden' } : {}),
        }}
      >
        <TopBar
          breadcrumb={breadcrumb}
          range={range}
          setRange={setRange}
          onOpenCmd={() => setCmdOpen(true)}
          workspace={workspace}
          setWorkspace={updateWorkspace}
          setView={setView}
          embedded={embedded}
          showMenu={isMobileNav}
          onOpenNav={() => setNavOpen(true)}
        />
        <div style={embedded ? { flex: 1, minHeight: 0, overflow: 'auto' } : { flex: 1 }}>
          {!workspace && view !== 'settings' && (!activePage || activePage.requiresWorkspace) ? (
            <WorkspaceEmptyState onCreate={goCreateWorkspace} />
          ) : !embedded && DATA_EMPTY[view] ? (
            <EmptyState message={DATA_EMPTY[view]!.message} description={DATA_EMPTY[view]!.description} />
          ) : (
          <>
          {Page && <Page workspace={workspace} navigate={setView} />}
          {view === 'overview'    && (embedded
            ? <OverviewPage range={range} setView={setView} setSelected={setSelected} tweaks={TWEAK_DEFAULTS} />
            : <OverviewLivePage range={range} setView={setView} setSelected={setSelected} tweaks={TWEAK_DEFAULTS} />)}
          {view === 'workflows'      && (selected.workflow
            ? (embedded
              ? <WorkflowDetailDemoPage workflow={WORKFLOWS.find(a => a.name === selected.workflow) ?? WORKFLOWS[0]} range={range} setView={setView} setSelected={setSelected} />
              : <WorkflowDetailLivePage workflowName={selected.workflow} range={range} setView={setView} setSelected={setSelected} />)
            : (embedded
              ? <WorkflowsPage workflows={WORKFLOWS} setView={setView} setSelected={setSelected} workspaceName={workspace?.name} />
              : <WorkflowsLivePage range={range} setView={setView} setSelected={setSelected} workspaceName={workspace?.name} />))}
          {view === 'trace'       && (embedded
            ? <TraceDetailDashPage setView={setView} />
            : selected.traceId
              ? <TraceDetailView traceId={selected.traceId} setView={setView} />
              : <EmptyState message="No trace selected" description="Open a trace from an workflow or the overview to see its detail." />)}
          {view === 'usage'       && (embedded
            ? <UsagePage range={range} />
            : <UsageLivePage range={range} />)}
          {view === 'keys'        && <ApiKeysPage demo={embedded} workspaceId={workspace?.id} />}
          {view === 'settings'    && <SettingsPage sections={extensions.settingsSections} createWorkspace={embedded ? undefined : createWorkspace} createMode={createWsIntent} onCancelCreate={() => setCreateWsIntent(false)} onOpenOverview={() => setView('overview')} demo={embedded} workspace={workspace} account={embedded ? null : readAccount()} />}
          {view === 'users'     && (embedded
            ? <UsersPage users={USERS} periodLabel="Apr 1 – Apr 30" setView={setView} setSelected={setSelected} />
            : <UsersLivePage range={range} setView={setView} setSelected={setSelected} />)}
          {view === 'user' && (embedded
            ? <UserDetailPage selected={selected} setView={setView} />
            : <UserDetailLivePage userId={selected.user || ''} range={range} setView={setView} setSelected={setSelected} />)}
          </>
          )}
        </div>
      </main>

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onSelect={handleCommandSelect}
      />
    </div>
  );
}

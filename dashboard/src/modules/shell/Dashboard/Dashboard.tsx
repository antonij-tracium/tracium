import { EMPTY_EXTENSIONS, validateExtensions, type DashboardExtensions, type ExtensionPage } from '../../../extensions';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useAPIClient } from '../../../common/providers/APIProvider';
import { Sidebar } from '../Sidebar';
import { TopBar } from '../TopBar';
import { CommandPalette } from '../CommandPalette';
import { OverviewPage, OverviewLivePage } from '../../overview';
import { WorkflowsPage, WorkflowsLivePage, WorkflowDetailDemoPage, WorkflowDetailLivePage, WORKFLOWS } from '../../workflows';
import { TraceDetailDashPage } from '../../trace-inspector';
import { TraceDetailView } from '../../trace-explorer';
import { UsersPage, UsersLivePage, UserDetailPage, UsagePage, UsageLivePage, USERS } from '../../usage';
import { UserDetailLivePage } from '../../usage/pages/UserDetailLivePage';
import { ApiKeysPage } from '../../api-keys';
import { SettingsPage } from '../../settings';
import { EmptyState, useMaxWidth, BREAKPOINTS } from '../../../common';
import { readAccount } from '../../auth';
import { createDemoWorkspace } from '../data';
import { useWorkspaces } from '../hooks/useWorkspaces';
import type { Workspace, BreadcrumbItem, CommandAction } from '../interfaces';
import type { ViewId } from '../ids';
import { stateToPath, pathToState, type NavState } from '../routing';
import { REDIRECT_KEY } from '../../auth';

export interface DashboardProps {
  extensions?: DashboardExtensions;
  // A contained demo preview: fits its parent and never touches storage or the URL.
  embedded?: boolean;
  onLogout?: () => void;
}

const VIEWS_WITH_RANGE: ViewId[] = ['overview', 'workflows', 'usage', 'users', 'user'];

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
      <p style={{ fontSize: 14.5, color: 'var(--muted)', maxWidth: 420, margin: 0, lineHeight: 1.5 }}>
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
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Create workspace
      </button>
    </div>
  );
}

// Deep links win: the current path, then a path stashed before the login
// redirect, then the last-visited view.
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

  // Query keys include workspaceId, so this alone refetches with the rebuilt
  // clients; manual invalidation would race the rebuild.
  const { setWorkspaceId } = useAPIClient();
  useEffect(() => {
    if (!persist) return;
    setWorkspaceId(workspace?.id);
  }, [persist, workspace?.id, setWorkspaceId]);
  const [cmdOpen, setCmdOpen] = useState(false);
  const isMobileNav = useMaxWidth(BREAKPOINTS.mobile) && !embedded;
  const [navOpen, setNavOpen] = useState(false);
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
      if (fallback) localStorage.setItem('tracium_ws', fallback.id);
      else localStorage.removeItem('tracium_ws');
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

  // Mirror navigation onto history so Back works and URLs are shareable.
  // popRef skips re-pushing a state that came from popstate; histInit makes
  // the first view replace the current entry.
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
    if (view === 'trace')      return [{ label: 'Overview', onClick: () => setView('overview') }, { label: selected.traceId ?? 'Trace' }];
    if (view === 'workflows')     return selected.workflow
      ? [{ label: 'Workflows', onClick: () => { setSelected(s => { const n = { ...s }; delete n.workflow; return n; }); setView('workflows'); } }, { label: selected.workflow }]
      : [{ label: 'Workflows' }];
    if (view === 'usage')      return [{ label: 'Usage' }];
    if (view === 'users')    return [{ label: 'Clients' }];
    if (view === 'user')     return [{ label: 'Clients', onClick: () => setView('users') }, { label: selected.user || 'Client detail' }];
    if (view === 'keys')       return [{ label: 'Settings', onClick: () => setView('settings') }, { label: 'API Keys' }];
    if (view === 'settings')   return [{ label: 'Settings' }];
    return [{ label: 'Overview' }];
  }, [view, selected.traceId, selected.workflow, selected.user]); // eslint-disable-line react-hooks/exhaustive-deps

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
          showRange={VIEWS_WITH_RANGE.includes(view)}
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
          ) : (
          <>
          {Page && <Page workspace={workspace} navigate={setView} />}
          {view === 'overview'    && (embedded
            ? <OverviewPage range={range} setView={setView} setSelected={setSelected} />
            : <OverviewLivePage range={range} setView={setView} setSelected={setSelected} />)}
          {view === 'workflows'      && (selected.workflow
            ? (embedded
              ? <WorkflowDetailDemoPage workflow={WORKFLOWS.find(a => a.name === selected.workflow) ?? WORKFLOWS[0]} range={range} setView={setView} setSelected={setSelected} />
              : <WorkflowDetailLivePage workflowName={selected.workflow} range={range} setView={setView} setSelected={setSelected} />)
            : (embedded
              ? <WorkflowsPage workflows={WORKFLOWS} range={range} setView={setView} setSelected={setSelected} workspaceName={workspace?.name} />
              : <WorkflowsLivePage range={range} setView={setView} setSelected={setSelected} workspaceName={workspace?.name} />))}
          {view === 'trace'       && (embedded
            ? <TraceDetailDashPage setView={setView} />
            : selected.traceId
              ? <TraceDetailView traceId={selected.traceId} setView={setView} setSelected={setSelected} />
              : <EmptyState message="No trace selected" description="Open a trace from a workflow or the overview to see its detail." />)}
          {view === 'usage'       && (embedded
            ? <UsagePage />
            : <UsageLivePage range={range} setView={setView} setSelected={setSelected} />)}
          {view === 'keys'        && <ApiKeysPage demo={embedded} workspaceId={workspace?.id} />}
          {view === 'settings'    && <SettingsPage sections={extensions.settingsSections} createWorkspace={embedded ? undefined : createWorkspace} createMode={createWsIntent} onCancelCreate={() => setCreateWsIntent(false)} onOpenOverview={() => setView('overview')} onOpenApiKeys={() => setView('keys')} demo={embedded} workspace={workspace} account={embedded ? null : readAccount()} />}
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

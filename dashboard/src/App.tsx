import { EMPTY_EXTENSIONS, type DashboardExtensions } from './extensions';
import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryProvider } from './common/providers/QueryProvider';
import { APIProvider } from './common/providers/APIProvider';
import { Dashboard } from './modules/shell';
import { LoginPage, SignupPage, TOKEN_KEY, EMAIL_KEY, REDIRECT_KEY, readInitialToken, storeSession } from './modules/auth';
import { InvitePage, readPendingInvite, clearPendingInvite } from './modules/invites';

/**
 * Catch-all for logged-out visitors. Stashes the deep link they tried to open
 * (e.g. a shared /traces/:id) before sending them to login, so the dashboard
 * can return them to it once authenticated. Auth routes themselves aren't
 * worth remembering.
 */
function RequireAuthRedirect() {
  const { pathname } = useLocation();
  React.useEffect(() => {
    if (pathname !== '/login' && pathname !== '/signup' && !pathname.startsWith('/invite/')) {
      sessionStorage.setItem(REDIRECT_KEY, pathname);
    }
  }, [pathname]);
  return <Navigate to="/login" replace />;
}

export interface AppProps { extensions?: DashboardExtensions }
export default function App({ extensions = EMPTY_EXTENSIONS }: AppProps = {}) {
  const [token, setToken] = useState<string | null>(readInitialToken);
  // A pending invite replaces the dashboard until it's accepted or dismissed.
  const [inviteToken, setInviteToken] = useState<string | null>(readPendingInvite);

  const leaveInvite = () => {
    clearPendingInvite();
    setInviteToken(null);
    window.history.replaceState(null, '', '/');
  };

  const handleInviteAccepted = (workspaceId: string) => {
    localStorage.setItem('tracium_ws', workspaceId);
    localStorage.setItem('tracium_view', 'overview');
    leaveInvite();
  };

  const handleLogin = (newToken: string, email: string) => {
    storeSession(newToken, email);
    setToken(newToken);
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    setToken(null);
  };

  if (!token) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage appearance={extensions.authAppearance} onLogin={handleLogin} />} />
          <Route path="/signup" element={<SignupPage appearance={extensions.authAppearance} onLogin={handleLogin} />} />
          {inviteToken && (
            <Route path="/invite/:token" element={<InvitePage token={inviteToken} appearance={extensions.authAppearance} session={null} onDismiss={leaveInvite} />} />
          )}
          {(extensions.authRoutes ?? []).map((route) => (
            <Route key={route.path} path={route.path} element={route.element} />
          ))}
          <Route path="*" element={<RequireAuthRedirect />} />
        </Routes>
      </BrowserRouter>
    );
  }

  if (inviteToken) {
    return (
      <BrowserRouter>
        <InvitePage
          token={inviteToken}
          appearance={extensions.authAppearance}
          session={{ token, email: localStorage.getItem(EMAIL_KEY) ?? '' }}
          onAccepted={handleInviteAccepted}
          onDismiss={leaveInvite}
          onSignOut={() => {
            handleLogout();
            window.history.replaceState(null, '', `/invite/${encodeURIComponent(inviteToken)}`);
          }}
        />
      </BrowserRouter>
    );
  }

  const apiConfig = {
    baseUrl: import.meta.env.VITE_API_URL || window.location.origin,
    apiKey: token,
  };

  const Onboarding = extensions.onboarding ?? React.Fragment;
  return (
    <QueryProvider onUnauthorized={handleLogout}>
      <APIProvider config={apiConfig}>
        <Onboarding><Dashboard onLogout={handleLogout} extensions={extensions} /></Onboarding>
      </APIProvider>
    </QueryProvider>
  );
}

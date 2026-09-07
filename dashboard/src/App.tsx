import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryProvider } from './common/providers/QueryProvider';
import { APIProvider } from './common/providers/APIProvider';
import { Dashboard } from './modules/shell';
import { LoginPage, SignupPage, TOKEN_KEY, EMAIL_KEY, REDIRECT_KEY, readInitialToken } from './modules/auth';

/**
 * Catch-all for logged-out visitors. Stashes the deep link they tried to open
 * (e.g. a shared /traces/:id) before sending them to login, so the dashboard
 * can return them to it once authenticated. Auth routes themselves aren't
 * worth remembering.
 */
function RequireAuthRedirect() {
  const { pathname } = useLocation();
  React.useEffect(() => {
    if (pathname !== '/login' && pathname !== '/signup') {
      sessionStorage.setItem(REDIRECT_KEY, pathname);
    }
  }, [pathname]);
  return <Navigate to="/login" replace />;
}

export default function App() {
  const [token, setToken] = useState<string | null>(readInitialToken);

  const handleLogin = (newToken: string, email: string) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(EMAIL_KEY, email);
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
          <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
          <Route path="/signup" element={<SignupPage onLogin={handleLogin} />} />
          <Route path="*" element={<RequireAuthRedirect />} />
        </Routes>
      </BrowserRouter>
    );
  }

  const apiConfig = {
    baseUrl: import.meta.env.VITE_API_URL || window.location.origin,
    apiKey: token,
  };

  return (
    <QueryProvider onUnauthorized={handleLogout}>
      <APIProvider config={apiConfig}>
        <Dashboard onLogout={handleLogout} />
      </APIProvider>
    </QueryProvider>
  );
}

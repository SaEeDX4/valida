import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { adminApi, ensureCsrf, setCsrfToken } from './api/adminClient.js';

/**
 * The Admin session as the browser knows it (Doc 11 s180-182): display name,
 * role hints and permissions for UX only. The server re-checks everything on
 * every request; nothing here is authority.
 */

const AdminSessionContext = createContext(null);

export function AdminSessionProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', admin: null, pending: null });

  const refresh = useCallback(async () => {
    try {
      await ensureCsrf();
      const data = await adminApi.get('/auth/session');
      if (data.authenticated) setState({ status: 'authenticated', admin: data, pending: null });
      else setState({ status: 'anonymous', admin: null, pending: data.pending ?? null });
    } catch {
      setState({ status: 'anonymous', admin: null, pending: null });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signedIn = useCallback((data) => setState({ status: 'authenticated', admin: data, pending: null }), []);

  const signOut = useCallback(async () => {
    try {
      await adminApi.post('/auth/logout');
    } catch {
      // The session may already be gone; either way the browser forgets it.
    }
    setCsrfToken(null);
    setState({ status: 'anonymous', admin: null, pending: null });
  }, []);

  /** Called when the server says the session ended (expired, revoked). */
  const sessionEnded = useCallback(() => {
    setCsrfToken(null);
    setState({ status: 'anonymous', admin: null, pending: null });
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      can: (permission) => Boolean(state.admin?.permissions?.includes(permission)),
      refresh,
      signedIn,
      signOut,
      sessionEnded,
    }),
    [state, refresh, signedIn, signOut, sessionEnded],
  );
  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession() {
  const value = useContext(AdminSessionContext);
  if (!value) throw new Error('useAdminSession must be used inside AdminSessionProvider');
  return value;
}

/** Only internal /admin paths are accepted as a return destination (Doc 11 s190-192). */
export function safeReturnPath(candidate) {
  if (typeof candidate !== 'string') return '/admin';
  if (!/^\/admin(\/[A-Za-z0-9/_-]*)?(\?[A-Za-z0-9=&_.%-]*)?$/.test(candidate)) return '/admin';
  if (candidate.startsWith('/admin/login') || candidate.includes('//')) return '/admin';
  return candidate;
}

import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { adminApi } from './api/adminClient.js';
import { useAdminSession } from './AdminSession.jsx';

const SESSION_ENDED = new Set(['AUTHENTICATION_REQUIRED', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'MFA_REQUIRED', 'MFA_ENROLLMENT_REQUIRED']);

/** Sends the Admin back to sign in when the server ends the session (Doc 11 s244), keeping a safe return path. */
export function useSessionGuard() {
  const session = useAdminSession();
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (error) => {
      if (error?.status === 401 && SESSION_ENDED.has(error.code)) {
        session.sessionEnded();
        navigate(`/admin/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
        return true;
      }
      return false;
    },
    [session, navigate, location.pathname, location.search],
  );
}

/** GET a resource; `path` null skips loading. */
export function useAdminResource(path) {
  const guard = useSessionGuard();
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) return undefined;
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    adminApi.get(path).then(
      (data) => active && setState({ data, error: null, loading: false }),
      (error) => {
        if (!active || guard(error)) return;
        setState({ data: null, error, loading: false });
      },
    );
    return () => {
      active = false;
    };
    // guard is stable enough per location; reload is driven by path and version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}

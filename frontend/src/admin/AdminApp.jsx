import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import Button from '../components/ui/Button/Button.jsx';
import { AdminSessionProvider, useAdminSession } from './AdminSession.jsx';
import { Loading } from './components.jsx';
import { ActivatePage, ForgotPasswordPage, LoginPage, MfaSetup, ResetPasswordPage } from './pages/AuthPages.jsx';
import { OverviewPage } from './pages/OverviewPage.jsx';
import { JobEditorPage, JobsPage, JobViewPage } from './pages/JobPages.jsx';
import { ApplicationPage, ApplicationsPage } from './pages/ApplicationPages.jsx';
import { AuditPage, SecurityPage, TeamPage } from './pages/AccountPages.jsx';
import styles from './admin.module.css';

/**
 * The Recruitment Admin application (E2; Doc 12 s141, Doc 11 s180).
 * Loaded on demand under /admin only; public visitors never download it.
 * The route guard is a convenience — every API call is authorised by the server (s180, s274).
 */

const NAV = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/jobs', label: 'Jobs', permission: 'jobs:read' },
  { to: '/admin/applications', label: 'Applications', permission: 'applications:read' },
  { to: '/admin/team', label: 'Team', permission: 'admins:read' },
  { to: '/admin/audit', label: 'Audit log', permission: 'audit:read' },
  { to: '/admin/security', label: 'Your security' },
];

function RequireAdmin() {
  const session = useAdminSession();
  const location = useLocation();
  if (session.status === 'loading') return <Loading label="Checking your session…" />;
  if (session.status !== 'authenticated') {
    if (session.pending === 'MFA_ENROLLMENT_REQUIRED') return <Navigate to="/admin/setup-mfa" replace />;
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/admin/login?returnTo=${returnTo}`} replace />;
  }
  return <AdminLayout />;
}

function AdminLayout() {
  const session = useAdminSession();
  const navigate = useNavigate();
  useEffect(() => {
    // Robots directives are not authentication (Doc 11 s254); the document server sends them too.
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'robots');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'noindex, nofollow');
    document.title = 'Valida Admin';
  }, []);
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <a href="/admin" className={styles.brand}>
          Valida <span className={styles.brandTag}>Admin</span>
        </a>
        <nav className={styles.nav} aria-label="Admin">
          <ul>
            {NAV.filter((item) => !item.permission || session.can(item.permission)).map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`.trim()}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.account}>
          <span>{session.admin.displayName}</span>
          <Button
            variant="secondary"
            size="compact"
            onClick={async () => {
              await session.signOut();
              navigate('/admin/login', { replace: true });
            }}
          >
            Sign out
          </Button>
        </div>
      </aside>
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <div className={styles.mainInner}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function AdminRoutes() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="activate" element={<ActivatePage />} />
      <Route path="setup-mfa" element={<MfaSetup />} />
      <Route path="forgot-password" element={<ForgotPasswordPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />
      <Route element={<RequireAdmin />}>
        <Route index element={<OverviewPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="jobs/new" element={<JobEditorPage />} />
        <Route path="jobs/:jobId" element={<JobViewPage />} />
        <Route path="jobs/:jobId/edit" element={<JobEditorPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="applications/:applicationId" element={<ApplicationPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}

export default function AdminApp() {
  return (
    <AdminSessionProvider>
      <AdminRoutes />
    </AdminSessionProvider>
  );
}

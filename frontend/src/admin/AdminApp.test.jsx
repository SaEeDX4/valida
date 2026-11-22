import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AdminSessionProvider, safeReturnPath } from './AdminSession.jsx';
import { AdminRoutes } from './AdminApp.jsx';
import { setCsrfToken } from './api/adminClient.js';
import { findAccessibilityViolations } from '../test/axe.js';

/**
 * E2 — the Admin application in the browser (Doc 11 s180-192, s250, s256-258;
 * Doc 12 s149-165). The API is a scripted fake: these tests prove the screens
 * send the right requests and present the server's answers; the server's own
 * rules are proven by the backend suites.
 */

const ok = (data) => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ success: true, data, meta: { requestId: 'qa' } }) });
const fail = (status, code, message) => ({ ok: false, status, headers: new Headers(), text: async () => JSON.stringify({ success: false, error: { code, message }, meta: { requestId: 'qa-req' } }) });

const OWNER = { authenticated: true, principalType: 'ADMIN', displayName: 'QA Owner', email: 'qa-owner@example.invalid', roles: ['ADMIN_OWNER'], permissions: ['jobs:read', 'jobs:create', 'jobs:update', 'jobs:publish', 'jobs:close', 'jobs:archive', 'applications:read', 'applications:status:update', 'applications:notes:write', 'applications:resume:read', 'applications:communication', 'audit:read', 'admins:read', 'admins:create', 'admins:update', 'admins:disable', 'admins:roles:update'] };
const OVERVIEW = { jobs: { accepting: 1, byStatus: { PUBLISHED: 1 } }, applications: { total: 3, awaitingReview: 2, byStatus: { RECEIVED: 2, IN_REVIEW: 1 }, resumesAwaitingScan: 1 } };

function application(overrides = {}) {
  return {
    application: {
      id: 'a1b2c3d4e5f6a1b2c3d4e5f6',
      status: 'RECEIVED',
      submittedAt: '2026-11-20T09:00:00.000Z',
      candidate: { fullName: 'QA Synthetic Candidate', email: 'qa.candidate@example.invalid', phone: null, message: 'QA message.' },
      screeningAnswers: [{ prompt: 'QA: can you work the hours?', type: 'YES_NO', answer: 'Yes' }],
      appliedRole: { title: 'QA Synthetic Role', slug: 'qa-role', location: 'QA Region', weeklyHours: 30 },
      currentJob: { id: 'f'.repeat(24), title: 'QA Synthetic Role', slug: 'qa-role', status: 'PUBLISHED', changedSinceApplication: false },
      resume: { originalFilename: 'QA résumé.pdf', extension: '.pdf', mimeType: 'application/pdf', sizeBytes: 20480, scanStatus: 'CLEAN', scanCheckedAt: '2026-11-20T09:05:00.000Z', available: true },
      statusHistory: [{ fromStatus: null, toStatus: 'RECEIVED', changedAt: '2026-11-20T09:00:00.000Z', changedBy: 'System', reason: null }],
      notes: [],
      communications: [],
      internalNotification: 'SENT',
      duplicates: [],
      ...overrides,
    },
    allowedNextStatuses: [{ status: 'IN_REVIEW', correction: false }, { status: 'ON_HOLD', correction: false }, { status: 'NOT_SELECTED', correction: false }, { status: 'WITHDRAWN', correction: false }],
    permissions: { updateStatus: true, writeNotes: true, recordCommunication: true, readResume: true },
  };
}

let routes;
let calls;
function installApi(table) {
  routes = table;
  calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = String(url).replace(/^.*\/api\/v1/, '');
    const method = init.method ?? 'GET';
    calls.push({ method, path, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined, credentials: init.credentials });
    const handler = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`];
    if (!handler) return fail(404, 'API_ROUTE_NOT_FOUND', `no fake for ${method} ${path}`);
    return typeof handler === 'function' ? handler(init) : handler;
  });
}

function renderAdmin(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/admin/*"
          element={
            <AdminSessionProvider>
              <AdminRoutes />
            </AdminSessionProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setCsrfToken(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('route guard and sign-in (Doc 11 s180, s185-190, s258)', () => {
  it('sends an anonymous visitor to sign in with a safe return path, then password + MFA lands on the page', async () => {
    let signedIn = false;
    installApi({
      'GET /auth/csrf': ok({ csrfToken: 'csrf-0' }),
      'GET /auth/session': () => ok(signedIn ? OWNER : { authenticated: false }),
      'POST /auth/login': ok({ authenticated: false, pending: 'MFA_REQUIRED', csrfToken: 'csrf-1' }),
      'POST /auth/mfa/verify': () => {
        signedIn = true;
        return ok({ ...OWNER, csrfToken: 'csrf-2' });
      },
      'GET /admin/applications': ok({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
      'GET /admin/jobs': ok({ items: [] }),
    });
    const user = userEvent.setup();
    renderAdmin('/admin/applications');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByLabelText(/password/i).getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByLabelText(/email/i).getAttribute('autocomplete')).toBe('username');
    await user.type(screen.getByLabelText(/email/i), 'qa-owner@example.invalid');
    await user.type(screen.getByLabelText(/password/i), 'QA synthetic passphrase 7 lanterns');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Two-step verification' })).toBeTruthy();
    await user.type(screen.getByLabelText(/authentication code/i), '123 456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeTruthy();
    const login = calls.find((c) => c.path === '/auth/login');
    expect(login.body).toEqual({ realm: 'ADMIN', email: 'qa-owner@example.invalid', password: 'QA synthetic passphrase 7 lanterns' });
    expect(login.headers['X-CSRF-Token']).toBe('csrf-0');
    expect(login.credentials).toBe('include');
    expect(calls.find((c) => c.path === '/auth/mfa/verify').headers['X-CSRF-Token']).toBe('csrf-1'); // rotated token used (s114)
  });

  it('keeps the email and clears the password after a failed sign-in, with the generic message (s56, s258)', async () => {
    installApi({
      'GET /auth/csrf': ok({ csrfToken: 'csrf-0' }),
      'GET /auth/session': ok({ authenticated: false }),
      'POST /auth/login': fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password.'),
    });
    const user = userEvent.setup();
    renderAdmin('/admin/login');
    await user.type(await screen.findByLabelText(/email/i), 'qa@example.invalid');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password-12');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Invalid email or password.')).toBeTruthy();
    expect(screen.getByLabelText(/email/i).value).toBe('qa@example.invalid');
    expect(screen.getByLabelText(/password/i).value).toBe('');
  });

  it('accepts only internal /admin return paths (s191)', () => {
    expect(safeReturnPath('/admin/applications?status=RECEIVED')).toBe('/admin/applications?status=RECEIVED');
    for (const bad of ['https://evil.example', '//evil.example/admin', '/careers', '/admin/../x', 'javascript:alert(1)', '/admin/login', null]) {
      expect(safeReturnPath(bad)).toBe('/admin');
    }
  });

  it('has no accessibility violations on the sign-in screen', async () => {
    installApi({ 'GET /auth/csrf': ok({ csrfToken: 'c' }), 'GET /auth/session': ok({ authenticated: false }) });
    const { container } = renderAdmin('/admin/login');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});

describe('activation link (s28, s250)', () => {
  it('reads the token from the URL fragment, removes it from history, and posts it with the password', async () => {
    window.history.replaceState(null, '', '/admin/activate#token=QAtoken_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    installApi({
      'GET /auth/csrf': ok({ csrfToken: 'c' }),
      'GET /auth/session': ok({ authenticated: false }),
      'POST /auth/activation': ok({ authenticated: false, pending: 'MFA_ENROLLMENT_REQUIRED', csrfToken: 'c2' }),
      'POST /auth/mfa/enroll/start': ok({ secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Valida:qa?secret=JBSWY3DPEHPK3PXP&issuer=Valida', expiresInSeconds: 600 }),
    });
    const user = userEvent.setup();
    renderAdmin('/admin/activate');
    expect(window.location.hash).toBe('');
    await user.type(await screen.findByLabelText(/^new password/i), 'QA synthetic passphrase 7 lanterns');
    await user.type(screen.getByLabelText(/confirm password/i), 'QA synthetic passphrase 7 lanterns');
    await user.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeTruthy();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeTruthy();
    expect(calls.find((c) => c.path === '/auth/activation').body).toEqual({ token: 'QAtoken_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', password: 'QA synthetic passphrase 7 lanterns' });
  });
});

describe('overview and application review (Doc 12 s142, s156-165)', () => {
  const signedInApi = (extra) => ({
    'GET /auth/csrf': ok({ csrfToken: 'c' }),
    'GET /auth/session': ok(OWNER),
    'GET /admin/overview': ok(OVERVIEW),
    ...extra,
  });

  it('shows only real numbers and owner navigation', async () => {
    installApi(signedInApi({}));
    renderAdmin('/admin');
    expect(await screen.findByText('Applications awaiting review')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Team' })).toBeTruthy();
  });

  it('hides owner-only navigation from a recruitment admin (UX only; the server enforces)', async () => {
    installApi(signedInApi({ 'GET /auth/session': ok({ ...OWNER, roles: ['RECRUITMENT_ADMIN'], permissions: OWNER.permissions.filter((p) => !p.startsWith('admins:') && p !== 'audit:read') }) }));
    renderAdmin('/admin');
    await screen.findByText('Applications awaiting review');
    expect(screen.queryByRole('link', { name: 'Audit log' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Team' })).toBeNull();
  });

  it('changes status with the expected current status, and explains a stale update', async () => {
    let status = 'RECEIVED';
    installApi(
      signedInApi({
        'GET /admin/applications/a1b2c3d4e5f6a1b2c3d4e5f6': () => ok(application({ status })),
        'POST /admin/applications/a1b2c3d4e5f6a1b2c3d4e5f6/status': (init) => {
          const body = JSON.parse(init.body);
          if (body.fromStatus !== status) return fail(409, 'STATUS_CONFLICT', 'This Application changed since you opened it. Reload to see its current status.');
          status = body.toStatus;
          return ok({ status });
        },
      }),
    );
    const user = userEvent.setup();
    const { container } = renderAdmin('/admin/applications/a1b2c3d4e5f6a1b2c3d4e5f6');
    expect(await screen.findByRole('heading', { name: 'QA Synthetic Candidate' })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Move to'), 'IN_REVIEW');
    await user.click(screen.getByRole('button', { name: 'Change status' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/status'))).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/status')).body).toEqual({ fromStatus: 'RECEIVED', toStatus: 'IN_REVIEW' });

    status = 'ON_HOLD'; // someone else moved it meanwhile; this screen still shows the old state until reload
    await waitFor(() => expect(screen.getAllByText('In review').length).toBeGreaterThan(0));
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });

  it('offers the résumé download only when the scan released it, and never shows a storage key', async () => {
    installApi(signedInApi({ 'GET /admin/applications/a1b2c3d4e5f6a1b2c3d4e5f6': ok(application({ resume: { ...application().application.resume, scanStatus: 'QUARANTINED', available: false } })) }));
    renderAdmin('/admin/applications/a1b2c3d4e5f6a1b2c3d4e5f6');
    const panel = (await screen.findByRole('heading', { name: 'Résumé' })).closest('section');
    expect(within(panel).getByText('Quarantined')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Download résumé' })).toBeNull();
    expect(within(panel).getByText(/released only after the malware scan/)).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/resumes\/[0-9a-f]{32}/);
  });

  it('sends the user back to sign in when the server ends the session (s244)', async () => {
    let session = OWNER;
    installApi(
      signedInApi({
        'GET /auth/session': () => ok(session),
        'GET /admin/applications/a1b2c3d4e5f6a1b2c3d4e5f6': () => {
          session = { authenticated: false };
          return fail(401, 'SESSION_EXPIRED', 'Your session has expired. Sign in again.');
        },
      }),
    );
    renderAdmin('/admin/applications/a1b2c3d4e5f6a1b2c3d4e5f6');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });
});

describe('Admin source hygiene (Doc 11 s183, s252; frontend guards)', () => {
  const adminDir = dirname(fileURLToPath(import.meta.url));
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(jsx?)$/.test(entry) && !entry.includes('.test.')) files.push(full);
    }
  })(adminDir);
  const code = (file) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('keeps tokens out of browser storage and cookies', () => {
    for (const file of files) expect(code(file), file).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
  });

  it('calls fetch only from the Admin API client', () => {
    for (const file of files.filter((f) => !f.endsWith('adminClient.js'))) expect(code(file), file).not.toMatch(/\bfetch\(/);
  });

  it('uses no inline styles, no console logging and no injected HTML', () => {
    for (const file of files) {
      expect(code(file), file).not.toMatch(/style=\{\{/);
      expect(code(file), file).not.toMatch(/console\.(log|info|debug)/);
      expect(code(file), file).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });
});

import { useState } from 'react';
import Alert from '../../components/ui/Alert/Alert.jsx';
import Button from '../../components/ui/Button/Button.jsx';
import Field from '../../components/ui/Field/Field.jsx';
import TextInput from '../../components/ui/TextInput/TextInput.jsx';
import { adminApi } from '../api/adminClient.js';
import { useAdminSession } from '../AdminSession.jsx';
import { Badge, ConfirmDialog, ErrorAlert, Loading, PageHeader, Pagination, RecoveryCodes, formatDateTime, useStepUp } from '../components.jsx';
import { useAdminResource, useSessionGuard } from '../useAdminResource.js';
import styles from '../admin.module.css';

/**
 * Owner account administration, the audit view and the Admin's own security
 * settings (Doc 11 s25-31, s83, s101-103, s133-137, s146-158, s198-201, s230).
 */

const ROLE_LABELS = { ADMIN_OWNER: 'Owner', RECRUITMENT_ADMIN: 'Recruitment admin' };
const DELIVERY = { SENT: 'Activation email sent.', NOT_CONFIGURED: 'Email is not configured here; ask the operator to issue the link with the provisioning tool.', FAILED: 'The activation email could not be sent. Try "Resend activation" later.' };

export function TeamPage() {
  const session = useAdminSession();
  const guard = useSessionGuard();
  const { withStepUp, stepUpDialog } = useStepUp();
  const { data, error, loading, reload } = useAdminResource(session.can('admins:read') ? '/admin/admins' : null);
  const [invite, setInvite] = useState({ email: '', displayName: '', role: 'RECRUITMENT_ADMIN' });
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!session.can('admins:read')) return <Alert tone="warning">Only an owner can manage the team.</Alert>;

  const act = async (request, success) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const result = await withStepUp(request);
      setNotice(typeof success === 'function' ? success(result) : success);
      reload();
      return true;
    } catch (failure) {
      if (failure.code !== 'STEP_UP_CANCELLED' && !guard(failure)) setActionError(failure);
      return false;
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const submitInvite = async (event) => {
    event.preventDefault();
    const ok = await act(() => adminApi.post('/admin/admins', { email: invite.email, displayName: invite.displayName, roles: [invite.role] }), (result) => `Account created. ${DELIVERY[result.activationDelivery] ?? ''}`);
    if (ok) setInvite({ email: '', displayName: '', role: 'RECRUITMENT_ADMIN' });
  };

  const confirmations = {
    disable: (a) => ({ title: `Disable ${a.displayName}?`, body: 'Their sessions end immediately and they cannot sign in until enabled again. Their history stays.', label: 'Disable', destructive: true, run: () => adminApi.post(`/admin/admins/${a.id}/disable`), done: 'Account disabled.' }),
    enable: (a) => ({ title: `Enable ${a.displayName}?`, body: 'They will be able to sign in again with their password and authenticator.', label: 'Enable', run: () => adminApi.post(`/admin/admins/${a.id}/enable`), done: 'Account enabled.' }),
    mfa: (a) => ({ title: `Reset two-step verification for ${a.displayName}?`, body: 'Use this only after verifying their identity independently (for example a video call). Their sessions end and they must set up an authenticator again at their next sign-in.', label: 'I verified their identity — reset', destructive: true, run: () => adminApi.post(`/admin/admins/${a.id}/mfa/reset`, { identityVerified: true }), done: 'Two-step verification reset.' }),
    resend: (a) => ({ title: `Send a new activation link to ${a.displayName}?`, body: 'Any earlier link stops working.', label: 'Send link', run: () => adminApi.post(`/admin/admins/${a.id}/activation`), done: (r) => DELIVERY[r.activationDelivery] ?? 'Done.' }),
    owner: (a) => ({ title: `Make ${a.displayName} an owner?`, body: 'Owners manage accounts and see the audit log. Their sessions end so the change applies at once.', label: 'Make owner', run: () => adminApi.patch(`/admin/admins/${a.id}/roles`, { roles: ['ADMIN_OWNER'] }), done: 'Role changed.' }),
    recruiter: (a) => ({ title: `Make ${a.displayName} a recruitment admin?`, body: 'They keep recruitment access but lose account and audit access. Their sessions end so the change applies at once.', label: 'Change role', destructive: true, run: () => adminApi.patch(`/admin/admins/${a.id}/roles`, { roles: ['RECRUITMENT_ADMIN'] }), done: 'Role changed.' }),
  };

  return (
    <>
      <PageHeader eyebrow="Owner" title="Team" lead="People who can sign in to Valida Admin. New people receive a one-time activation link at their own email." />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <ErrorAlert error={actionError} title="Not changed" />
      <ErrorAlert error={error} title="The team could not be loaded" />
      {loading ? <Loading /> : null}
      {data ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">State</th>
                <th scope="col">Last sign-in</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.displayName}</strong>
                    <span className={styles.timelineMeta}>{a.email}</span>
                  </td>
                  <td>{a.roles.map((r) => ROLE_LABELS[r]).join(', ')}</td>
                  <td>
                    {a.status === 'DISABLED' ? <Badge tone="error">Disabled</Badge> : a.activated ? <Badge tone="success">Active</Badge> : <Badge tone="warning">{a.activationPending ? 'Invited' : 'Link expired'}</Badge>}{' '}
                    {a.activated && !a.mfaEnabled ? <Badge tone="warning">MFA not set up</Badge> : null}
                  </td>
                  <td>{formatDateTime(a.lastLoginAt)}</td>
                  <td>
                    <div className={styles.actions}>
                      {!a.activated && a.status === 'ACTIVE' ? (
                        <Button size="compact" variant="secondary" onClick={() => setConfirm(confirmations.resend(a))}>
                          Resend activation
                        </Button>
                      ) : null}
                      {a.roles.includes('ADMIN_OWNER') ? (
                        <Button size="compact" variant="ghost" onClick={() => setConfirm(confirmations.recruiter(a))}>
                          Make recruitment admin
                        </Button>
                      ) : (
                        <Button size="compact" variant="ghost" onClick={() => setConfirm(confirmations.owner(a))}>
                          Make owner
                        </Button>
                      )}
                      {a.mfaEnabled && a.email !== session.admin.email ? (
                        <Button size="compact" variant="ghost" onClick={() => setConfirm(confirmations.mfa(a))}>
                          Reset MFA
                        </Button>
                      ) : null}
                      {a.status === 'ACTIVE' ? (
                        <Button size="compact" variant="ghost" onClick={() => setConfirm(confirmations.disable(a))}>
                          Disable
                        </Button>
                      ) : (
                        <Button size="compact" variant="ghost" onClick={() => setConfirm(confirmations.enable(a))}>
                          Enable
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {session.can('admins:create') ? (
        <section className={styles.panel} aria-labelledby="invite-heading">
          <h2 id="invite-heading" className={styles.sectionTitle}>
            Add a person
          </h2>
          <form className={styles.formNarrow} onSubmit={submitInvite} noValidate>
            <Field label="Work email" required>
              {(props) => <TextInput {...props} type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />}
            </Field>
            <Field label="Display name" required>
              {(props) => <TextInput {...props} value={invite.displayName} onChange={(e) => setInvite({ ...invite, displayName: e.target.value })} />}
            </Field>
            <Field label="Role">
              {(props) => (
                <select {...props} className={styles.select} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                  <option value="RECRUITMENT_ADMIN">Recruitment admin — jobs and applications</option>
                  <option value="ADMIN_OWNER">Owner — everything, including accounts and audit</option>
                </select>
              )}
            </Field>
            <Button type="submit" loading={busy}>
              Create account and send activation link
            </Button>
          </form>
        </section>
      ) : null}
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title ?? ''}
        body={confirm?.body ?? ''}
        confirmLabel={confirm?.label ?? ''}
        destructive={Boolean(confirm?.destructive)}
        busy={busy}
        onConfirm={() => act(confirm.run, confirm.done)}
        onCancel={() => setConfirm(null)}
      />
      {stepUpDialog}
    </>
  );
}

const ACTION_LABELS = {
  ADMIN_ACCOUNT_CREATED: 'Account created',
  ADMIN_ACCOUNT_DISABLED: 'Account disabled',
  ADMIN_ACCOUNT_ENABLED: 'Account enabled',
  ADMIN_ROLE_CHANGED: 'Role changed',
  ADMIN_ACTIVATION_ISSUED: 'Activation link issued',
  ADMIN_ACTIVATED: 'Account activated',
  AUTH_LOGIN_SUCCESS: 'Signed in',
  AUTH_LOGIN_FAILED: 'Sign-in failed',
  AUTH_ACCOUNT_LOCKED: 'Sign-in locked (15 min)',
  AUTH_LOGOUT: 'Signed out',
  PASSWORD_CHANGED: 'Password changed',
  PASSWORD_RESET_REQUESTED: 'Password reset requested',
  PASSWORD_RESET_COMPLETED: 'Password reset',
  MFA_ENROLLED: 'Two-step verification set up',
  MFA_FAILED: 'Wrong authentication code',
  MFA_RECOVERY_CODE_USED: 'Recovery code used',
  MFA_RECOVERY_CODES_REGENERATED: 'Recovery codes replaced',
  MFA_RESET: 'Two-step verification reset',
  SESSION_REVOKED: 'Session ended',
  SESSIONS_REVOKED_OTHERS: 'Other sessions ended',
  JOB_CREATED: 'Job created',
  JOB_UPDATED: 'Job edited',
  JOB_PUBLISHED: 'Job published',
  JOB_REOPENED: 'Job reopened',
  JOB_CLOSED: 'Job closed',
  JOB_ARCHIVED: 'Job archived',
  RESUME_ACCESSED: 'Résumé downloaded',
  APPLICATION_STATUS_CHANGED: 'Status changed',
  APPLICATION_NOTE_ADDED: 'Note added',
  APPLICATION_COMMUNICATION_RECORDED: 'Communication recorded',
  ADMIN_RESTORE_REBASELINED: 'Admin re-baselined after a restore',
};

function describeMetadata(metadata) {
  if (metadata.fromStatus) return `${metadata.fromStatus} → ${metadata.toStatus}${metadata.reasonProvided ? ' (with reason)' : ''}`;
  if (metadata.transition) return metadata.transition.replace('->', ' → ');
  if (metadata.roles) return metadata.roles.join(', ');
  if (metadata.method) return metadata.method === 'RECOVERY_CODE' ? 'with a recovery code' : 'with an authenticator code';
  if (metadata.kind) return `${metadata.kind.toLowerCase()} · ${metadata.direction?.toLowerCase() ?? ''}`;
  if (metadata.fields) return `fields: ${metadata.fields.join(', ')}`;
  if (metadata.outcome) return metadata.outcome.toLowerCase().replace(/_/g, ' ');
  return '';
}

export function AuditPage() {
  const session = useAdminSession();
  const [page, setPage] = useState(1);
  const [resourceType, setResourceType] = useState('');
  const { data, error, loading } = useAdminResource(session.can('audit:read') ? `/admin/audit?page=${page}${resourceType ? `&resourceType=${resourceType}` : ''}` : null);
  if (!session.can('audit:read')) return <Alert tone="warning">Only an owner can see the audit log.</Alert>;
  return (
    <>
      <PageHeader eyebrow="Owner" title="Audit log" lead="Important actions, newest first. Entries cannot be edited or deleted, and never contain passwords, codes, notes or candidate details." />
      <div className={styles.toolbar}>
        <Field label="Area">
          {(props) => (
            <select
              {...props}
              className={styles.select}
              value={resourceType}
              onChange={(e) => {
                setResourceType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Everything</option>
              <option value="APPLICATION">Applications</option>
              <option value="JOB">Jobs</option>
              <option value="ADMIN">Accounts and sign-in</option>
            </select>
          )}
        </Field>
      </div>
      <ErrorAlert error={error} title="The audit log could not be loaded" />
      {loading ? <Loading /> : null}
      {data ? (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">Action</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.occurredAt)}</td>
                    <td>{event.actor}</td>
                    <td>{ACTION_LABELS[event.action] ?? event.action}</td>
                    <td>
                      {describeMetadata(event.metadata)}
                      {event.resource.type === 'APPLICATION' && event.resource.id ? (
                        <>
                          {' '}
                          <a href={`/admin/applications/${event.resource.id}`}>open</a>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination pagination={data.pagination} onPage={setPage} />
        </>
      ) : null}
    </>
  );
}

export function SecurityPage() {
  const session = useAdminSession();
  const guard = useSessionGuard();
  const { withStepUp, stepUpDialog } = useStepUp();
  const sessions = useAdminResource('/auth/sessions');
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [codes, setCodes] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (request, success) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await withStepUp(request);
      if (success) setNotice(success);
      sessions.reload();
      return result;
    } catch (failure) {
      if (failure.code !== 'STEP_UP_CANCELLED' && !guard(failure)) setError(failure);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    if (passwords.next !== passwords.confirm) {
      setError({ message: 'The new passwords do not match.' });
      return;
    }
    const result = await run(() => adminApi.post('/auth/password/change', { currentPassword: passwords.current, newPassword: passwords.next }), 'Password changed. Your other sessions were signed out.');
    if (result) {
      setPasswords({ current: '', next: '', confirm: '' });
      session.signedIn(result);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Account" title="Your security" lead={`Signed in as ${session.admin.email}.`} />
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <ErrorAlert error={error} title="Not changed" />
      <div className={styles.grid2}>
        <section className={styles.panel} aria-labelledby="sessions-heading">
          <h2 id="sessions-heading" className={styles.sectionTitle}>
            Signed-in sessions
          </h2>
          <ErrorAlert error={sessions.error} title="Sessions could not be loaded" />
          {sessions.data ? (
            <ul className={styles.timeline}>
              {sessions.data.items.map((s) => (
                <li key={s.id} className={styles.timelineItem}>
                  {s.device} {s.current ? <Badge tone="info">This session</Badge> : null}
                  <span className={styles.timelineMeta}>
                    Signed in {formatDateTime(s.createdAt)} · last active {formatDateTime(s.lastActivityAt)}
                  </span>
                  {!s.current ? (
                    <Button size="compact" variant="ghost" onClick={() => run(() => adminApi.del(`/auth/sessions/${s.id}`), 'Session ended.')}>
                      End session
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <Button variant="secondary" loading={busy} onClick={() => run(() => adminApi.post('/auth/sessions/revoke-others'), 'All other sessions were ended.')}>
            Sign out everywhere else
          </Button>
        </section>
        <section className={styles.panel} aria-labelledby="recovery-heading">
          <h2 id="recovery-heading" className={styles.sectionTitle}>
            Recovery codes
          </h2>
          {codes ? (
            <RecoveryCodes codes={codes} onConfirmed={() => setCodes(null)} />
          ) : (
            <>
              <p className={styles.lead}>Create a new set of 10 recovery codes. Your previous codes stop working.</p>
              <Button
                variant="secondary"
                loading={busy}
                onClick={async () => {
                  const result = await run(() => adminApi.post('/auth/mfa/recovery-codes/regenerate'));
                  if (result) setCodes(result.recoveryCodes);
                }}
              >
                Create new recovery codes
              </Button>
            </>
          )}
        </section>
      </div>
      <section className={styles.panel} aria-labelledby="password-heading">
        <h2 id="password-heading" className={styles.sectionTitle}>
          Change password
        </h2>
        <form className={styles.formNarrow} onSubmit={changePassword} noValidate>
          <Field label="Current password" required>
            {(props) => <TextInput {...props} type="password" autoComplete="current-password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} />}
          </Field>
          <Field label="New password" required description="12 to 128 characters.">
            {(props) => <TextInput {...props} type="password" autoComplete="new-password" value={passwords.next} onChange={(e) => setPasswords({ ...passwords, next: e.target.value })} />}
          </Field>
          <Field label="Confirm new password" required>
            {(props) => <TextInput {...props} type="password" autoComplete="new-password" value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} />}
          </Field>
          <Button type="submit" loading={busy}>
            Change password
          </Button>
        </form>
      </section>
      {stepUpDialog}
    </>
  );
}

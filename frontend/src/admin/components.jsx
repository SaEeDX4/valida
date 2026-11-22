import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import Alert from '../components/ui/Alert/Alert.jsx';
import Button from '../components/ui/Button/Button.jsx';
import Field from '../components/ui/Field/Field.jsx';
import TextInput from '../components/ui/TextInput/TextInput.jsx';
import { adminApi } from './api/adminClient.js';
import styles from './admin.module.css';

/* ------------------------------------------------------------- labels -- */

export const APPLICATION_STATUS_LABELS = Object.freeze({
  RECEIVED: 'Received',
  IN_REVIEW: 'In review',
  SCREENING: 'Screening',
  INTERVIEW: 'Interview',
  ASSESSMENT: 'Assessment',
  FINAL_REVIEW: 'Final review',
  ON_HOLD: 'On hold',
  SELECTED: 'Selected',
  NOT_SELECTED: 'Not selected',
  WITHDRAWN: 'Withdrawn',
});

export const JOB_STATUS_LABELS = Object.freeze({ DRAFT: 'Draft', PUBLISHED: 'Published', CLOSED: 'Closed', ARCHIVED: 'Archived' });

export const SCAN_LABELS = Object.freeze({
  CLEAN: 'Scanned — clean',
  NOT_SCANNED: 'Awaiting scan',
  PENDING: 'Scanning',
  QUARANTINED: 'Quarantined',
  FAILED: 'Scan failed — held',
});

export const COMMUNICATION_KIND_LABELS = Object.freeze({
  APPLICATION_ACKNOWLEDGEMENT: 'Acknowledgement',
  SCREENING: 'Screening',
  INTERVIEW: 'Interview',
  ASSESSMENT: 'Assessment',
  GENERAL_RECRUITMENT: 'General',
  SELECTION: 'Selection',
  NOT_SELECTED: 'Not selected',
  WITHDRAWAL: 'Withdrawal',
});

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date);
}

/* --------------------------------------------------------------- pieces -- */

export function PageHeader({ eyebrow, title, lead, actions }) {
  return (
    <header className={styles.pageHeader}>
      <div>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 className={styles.title}>{title}</h1>
        {lead ? <p className={styles.lead}>{lead}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}

export function Badge({ tone = 'neutral', children }) {
  const cls = { success: styles.badgeSuccess, warning: styles.badgeWarning, error: styles.badgeError, info: styles.badgeInfo }[tone] ?? styles.badge;
  return <span className={cls}>{children}</span>;
}

const APPLICATION_TONES = { RECEIVED: 'info', SELECTED: 'success', NOT_SELECTED: 'neutral', WITHDRAWN: 'neutral', ON_HOLD: 'warning' };
export function ApplicationStatusBadge({ status }) {
  return <Badge tone={APPLICATION_TONES[status] ?? 'info'}>{APPLICATION_STATUS_LABELS[status] ?? status}</Badge>;
}

const JOB_TONES = { DRAFT: 'neutral', PUBLISHED: 'success', CLOSED: 'warning', ARCHIVED: 'neutral' };
export function JobStatusBadge({ status }) {
  return <Badge tone={JOB_TONES[status]}>{JOB_STATUS_LABELS[status] ?? status}</Badge>;
}

const SCAN_TONES = { CLEAN: 'success', QUARANTINED: 'error', FAILED: 'error', PENDING: 'warning', NOT_SCANNED: 'warning' };
export function ScanBadge({ status }) {
  return <Badge tone={SCAN_TONES[status]}>{SCAN_LABELS[status] ?? status}</Badge>;
}

export function ErrorAlert({ error, title = 'That did not work' }) {
  if (!error) return null;
  return (
    <Alert tone="error" title={title}>
      {error.message}
      {error.requestId ? <span className={styles.muted}> Reference: {error.requestId}</span> : null}
    </Alert>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <p role="status" className={styles.muted}>
      {label}
    </p>
  );
}

export function Pagination({ pagination, onPage }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages, total } = pagination;
  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <span>
        Page {page} of {totalPages} · {total} total
      </span>
      <span className={styles.actions}>
        <Button variant="secondary" size="compact" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" size="compact" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </span>
    </nav>
  );
}

/* --------------------------------------------------------------- dialog -- */

/** A native modal <dialog>: focus is trapped by the browser and Escape closes it. */
export function Dialog({ open, title, onClose, children }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);
  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      {open ? (
        <div className={styles.form}>
          <h2 id={titleId} className={styles.sectionTitle}>
            {title}
          </h2>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel, destructive = false, busy = false, onConfirm, onCancel }) {
  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      <p className={styles.lead}>{body}</p>
      <div className={styles.actions}>
        <Button variant={destructive ? 'destructive' : 'primary'} loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * Step-up authentication (Doc 11 s135-137). Wrap a high-risk action with
 * `withStepUp(action)`: if the server answers RECENT_AUTH_REQUIRED, the dialog
 * asks for the password and a current code, then runs the action again.
 */
export function useStepUp() {
  const [pending, setPending] = useState(null);
  const withStepUp = useCallback(
    (action) =>
      new Promise((resolve, reject) => {
        action().then(resolve, (error) => {
          if (error?.code === 'RECENT_AUTH_REQUIRED') setPending({ action, resolve, reject });
          else reject(error);
        });
      }),
    [],
  );
  const dialog = pending ? (
    <StepUpDialog
      onDone={async () => {
        const { action, resolve, reject } = pending;
        setPending(null);
        action().then(resolve, reject);
      }}
      onCancel={() => {
        pending.reject(Object.assign(new Error('Confirmation cancelled.'), { code: 'STEP_UP_CANCELLED' }));
        setPending(null);
      }}
    />
  ) : null;
  return { withStepUp, stepUpDialog: dialog };
}

function StepUpDialog({ onDone, onCancel }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.post('/auth/reauthenticate', { password, code });
      onDone();
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  };
  return (
    <Dialog open title="Confirm it is you" onClose={onCancel}>
      <p className={styles.lead}>This change needs your password and a current code from your authenticator app.</p>
      <form className={styles.form} onSubmit={submit} noValidate>
        <ErrorAlert error={error} />
        <Field label="Password" required>
          {(props) => <TextInput {...props} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="Authentication code" required>
          {(props) => <TextInput {...props} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
        <div className={styles.actions}>
          <Button type="submit" loading={busy}>
            Confirm
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------ MFA pieces -- */

/** An SVG QR code drawn from the module matrix (no HTML injection). */
export function QrCode({ value, label }) {
  const matrix = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const cells = [];
    for (let row = 0; row < count; row += 1) for (let col = 0; col < count; col += 1) if (qr.isDark(row, col)) cells.push([col, row]);
    return { count, cells };
  }, [value]);
  return (
    <svg className={styles.qr} viewBox={`-2 -2 ${matrix.count + 4} ${matrix.count + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x="-2" y="-2" width={matrix.count + 4} height={matrix.count + 4} fill="#ffffff" />
      <path d={matrix.cells.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('')} fill="#05070a" />
    </svg>
  );
}

export function RecoveryCodes({ codes, onConfirmed }) {
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');
  const download = () => {
    const blob = new Blob([`Valida Admin recovery codes\nEach code works once.\n\n${text}\n`], { type: 'text/plain' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = 'valida-admin-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(href);
  };
  return (
    <div className={styles.form}>
      <Alert tone="warning" title="Save these recovery codes now">
        They are shown only once. Each code signs you in one time if you lose your authenticator. Store them in your password manager.
      </Alert>
      <ul className={styles.codes} aria-label="Recovery codes">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(text)}>
          Copy codes
        </Button>
        <Button variant="secondary" onClick={download}>
          Download as a text file
        </Button>
      </div>
      <label className={styles.checkbox}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved my recovery codes
      </label>
      {onConfirmed ? (
        <Button disabled={!saved} onClick={onConfirmed}>
          Continue
        </Button>
      ) : null}
    </div>
  );
}

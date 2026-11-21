import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import Alert from '../../components/ui/Alert/Alert.jsx';
import Button from '../../components/ui/Button/Button.jsx';
import Field from '../../components/ui/Field/Field.jsx';
import TextInput from '../../components/ui/TextInput/TextInput.jsx';
import { adminApi } from '../api/adminClient.js';
import { safeReturnPath, useAdminSession } from '../AdminSession.jsx';
import { ErrorAlert, QrCode, RecoveryCodes } from '../components.jsx';
import styles from '../admin.module.css';

/**
 * Authentication screens — Doc 11 s185-192, s250, s256-258.
 * Visible labels, password-manager semantics, paste allowed, one code input,
 * errors announced near the form, internal-only return paths.
 */

function AuthCard({ title, lead, wide = false, children }) {
  return (
    <main className={styles.authScreen}>
      <div className={wide ? styles.authCardWide : styles.authCard}>
        <div>
          <p className={styles.eyebrow}>Valida Admin</p>
          <h1 className={styles.title}>{title}</h1>
          {lead ? <p className={styles.lead}>{lead}</p> : null}
        </div>
        {children}
      </div>
    </main>
  );
}

/** Reads #token=… once and removes it from the address bar and history (s250). */
function useFragmentToken() {
  const [token] = useState(() => {
    const match = /(?:^#|&)token=([A-Za-z0-9_-]{20,200})/.exec(window.location.hash);
    return match ? match[1] : null;
  });
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  return token;
}

function MfaChallenge({ onSuccess }) {
  const [mode, setMode] = useState('code');
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  useEffect(() => input.current?.focus(), [mode]);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await adminApi.post('/auth/mfa/verify', mode === 'code' ? { code: value } : { recoveryCode: value });
      onSuccess(data);
    } catch (failure) {
      setError(failure);
      setBusy(false);
      if (failure.code === 'MFA_CHALLENGE_ENDED' || failure.status === 401 && failure.code !== 'INVALID_MFA_CODE') onSuccess(null, failure);
    }
  };
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <ErrorAlert error={error} title="Not signed in" />
      <Field label={mode === 'code' ? 'Authentication code' : 'Recovery code'} description={mode === 'code' ? 'The 6-digit code from your authenticator app.' : 'One of the recovery codes you saved. Each works once.'} required>
        {(props) => (
          <TextInput
            {...props}
            ref={input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode={mode === 'code' ? 'numeric' : 'text'}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
          />
        )}
      </Field>
      <Button type="submit" loading={busy}>
        Verify
      </Button>
      <Button variant="text" onClick={() => { setMode(mode === 'code' ? 'recovery' : 'code'); setValue(''); setError(null); }}>
        {mode === 'code' ? 'Use a recovery code instead' : 'Use my authenticator app instead'}
      </Button>
    </form>
  );
}

export function LoginPage() {
  const session = useAdminSession();
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = safeReturnPath(new URLSearchParams(location.search).get('returnTo'));
  const [step, setStep] = useState(session.pending === 'MFA_REQUIRED' ? 'mfa' : 'password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(location.state?.notice ?? null);
  const [busy, setBusy] = useState(false);

  if (session.status === 'authenticated') return <Navigate to={returnTo} replace />;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await adminApi.post('/auth/login', { realm: 'ADMIN', email, password });
      setPassword('');
      if (data.pending === 'MFA_ENROLLMENT_REQUIRED') navigate('/admin/setup-mfa', { replace: true });
      else setStep('mfa');
    } catch (failure) {
      setPassword(''); // s258: keep the email, clear the password
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'mfa') {
    return (
      <AuthCard title="Two-step verification" lead="Enter the code from your authenticator app to finish signing in.">
        <MfaChallenge
          onSuccess={(data, failure) => {
            if (data) {
              session.signedIn(data);
              navigate(returnTo, { replace: true });
            } else if (failure) {
              setStep('password');
              setError(failure);
            }
          }}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in" lead="Recruitment administration for Valida.">
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <form className={styles.form} onSubmit={submit} noValidate>
        <ErrorAlert error={error} title="Not signed in" />
        <Field label="Email" required>
          {(props) => <TextInput {...props} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password" required>
          {(props) => <TextInput {...props} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" loading={busy}>
          Continue
        </Button>
      </form>
      <Link to="/admin/forgot-password" className={styles.rowLink}>
        Forgot your password?
      </Link>
    </AuthCard>
  );
}

/** Password then MFA enrolment, from an activation link (s28) or after an owner reset MFA. */
export function ActivatePage() {
  const token = useFragmentToken();
  const [step, setStep] = useState('password');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!token && step === 'password') {
    return (
      <AuthCard title="Activation link needed" lead="Open the activation link from your email. If it has expired, ask the Valida owner for a new one.">
        <Link to="/admin/login" className={styles.rowLink}>
          Go to sign in
        </Link>
      </AuthCard>
    );
  }
  if (step === 'mfa') return <MfaSetup />;

  const submit = async (event) => {
    event.preventDefault();
    if (password !== confirm) {
      setError({ message: 'The two passwords do not match.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.post('/auth/activation', { token, password });
      setStep('mfa');
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Activate your account" lead="Choose a password of at least 12 characters. A passphrase of several words works well; your password manager can generate one.">
      <form className={styles.form} onSubmit={submit} noValidate>
        <ErrorAlert error={error} title="Not activated" />
        <Field label="New password" required description="12 to 128 characters. Avoid common or predictable passwords.">
          {(props) => <TextInput {...props} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="Confirm password" required>
          {(props) => <TextInput {...props} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <Button type="submit" loading={busy}>
          Set password
        </Button>
      </form>
    </AuthCard>
  );
}

/** s69-71, s77-79 — TOTP enrolment with a QR code, the manual key, and one-time recovery codes. */
export function MfaSetup() {
  const session = useAdminSession();
  const navigate = useNavigate();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    adminApi
      .post('/auth/mfa/enroll/start')
      .then((data) => active && setSetup(data))
      .catch((failure) => active && setError(failure));
    return () => {
      active = false;
    };
  }, []);

  if (codes) {
    return (
      <AuthCard wide title="Save your recovery codes">
        <RecoveryCodes
          codes={codes}
          onConfirmed={() => {
            session.signedIn(result);
            navigate('/admin', { replace: true });
          }}
        />
      </AuthCard>
    );
  }

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await adminApi.post('/auth/mfa/enroll/verify', { code });
      setResult(data);
      setCodes(data.recoveryCodes);
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  };

  const grouped = setup?.secret?.match(/.{1,4}/g)?.join(' ');
  return (
    <AuthCard wide title="Set up two-step verification" lead="Scan the code with an authenticator app (for example Microsoft Authenticator, Google Authenticator or 1Password), then enter the 6-digit code it shows.">
      <ErrorAlert error={error} title="Not set up yet" />
      {error?.code === 'AUTHENTICATION_REQUIRED' || error?.code === 'SESSION_EXPIRED' ? (
        <Link to="/admin/login" className={styles.rowLink}>
          Sign in again
        </Link>
      ) : null}
      {setup ? (
        <>
          <QrCode value={setup.otpauthUri} label="QR code for your authenticator app" />
          <div>
            <p className={styles.lead}>Cannot scan? Enter this key in the app instead:</p>
            <p className={styles.secret}>{grouped}</p>
            <a className={styles.rowLink} href={setup.otpauthUri}>
              Open in an authenticator app on this device
            </a>
          </div>
          <form className={styles.formNarrow} onSubmit={submit} noValidate>
            <Field label="6-digit code" required>
              {(props) => <TextInput {...props} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />}
            </Field>
            <Button type="submit" loading={busy}>
              Verify and continue
            </Button>
          </form>
        </>
      ) : null}
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await adminApi.post('/auth/password/forgot', { realm: 'ADMIN', email });
      setMessage(data.message);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Reset your password" lead="Enter your account email. Your two-step verification stays as it is.">
      {message ? (
        <Alert tone="success">{message}</Alert>
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          <ErrorAlert error={error} />
          <Field label="Email" required>
            {(props) => <TextInput {...props} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Button type="submit" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
      <Link to="/admin/login" className={styles.rowLink}>
        Back to sign in
      </Link>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const token = useFragmentToken();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!token) {
    return (
      <AuthCard title="Reset link needed" lead="Open the reset link from your email, or request a new one.">
        <Link to="/admin/forgot-password" className={styles.rowLink}>
          Request a reset link
        </Link>
      </AuthCard>
    );
  }
  const submit = async (event) => {
    event.preventDefault();
    if (password !== confirm) {
      setError({ message: 'The two passwords do not match.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.post('/auth/password/reset', { token, password });
      navigate('/admin/login', { replace: true, state: { notice: 'Your password was changed. Sign in with it and your authenticator code.' } });
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  };
  return (
    <AuthCard title="Choose a new password" lead="All signed-in sessions will end. You will sign in again with the new password and your authenticator.">
      <form className={styles.form} onSubmit={submit} noValidate>
        <ErrorAlert error={error} title="Not changed" />
        <Field label="New password" required description="12 to 128 characters.">
          {(props) => <TextInput {...props} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="Confirm password" required>
          {(props) => <TextInput {...props} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <Button type="submit" loading={busy}>
          Change password
        </Button>
      </form>
    </AuthCard>
  );
}

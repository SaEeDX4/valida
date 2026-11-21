/**
 * Admin account emails — Doc 11 s28, s32, s127, s193-194.
 *
 * Links are built from the configured ADMIN_APP_ORIGIN only (s32), with the
 * token in the URL FRAGMENT: a fragment is never sent to a server, so the token
 * stays out of access logs and Referer headers (s128, s250-251). Messages never
 * contain a password, MFA secret, recovery code or session id (s194).
 */

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(title, paragraphs, link) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join('');
  const button = link
    ? `<p style="margin:24px 0"><a href="${escapeHtml(link.href)}" style="background:#2f6bff;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(link.label)}</a></p><p style="margin:0 0 16px;font-size:13px;color:#555">If the button does not work, copy this address into your browser:<br>${escapeHtml(link.href)}</p>`
    : '';
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px"><h1 style="font-size:20px">${escapeHtml(title)}</h1>${body}${button}<p style="font-size:12px;color:#666">Valida Recruitment Admin. You received this because an account with this address exists.</p></body></html>`;
}

export function activationMessage({ appOrigin, token, displayName, expiresHours = 8 }) {
  const href = `${appOrigin}/admin/activate#token=${token}`;
  const lines = [
    `Hello ${displayName},`,
    'A Valida Recruitment Admin account has been created for you.',
    `Open the link below to set your password and set up two-step verification. The link works once and expires in ${expiresHours} hours.`,
    'If you did not expect this message, ignore it; no account becomes usable without it.',
  ];
  return { subject: 'Activate your Valida Admin account', text: `${lines.join('\n\n')}\n\n${href}\n`, html: page('Activate your account', lines, { href, label: 'Activate account' }) };
}

export function resetMessage({ appOrigin, token }) {
  const href = `${appOrigin}/admin/reset-password#token=${token}`;
  const lines = [
    'A password reset was requested for your Valida Recruitment Admin account.',
    'Open the link below to choose a new password. The link works once and expires in 30 minutes. Your two-step verification stays as it is.',
    'If you did not request this, ignore this message; your password has not changed.',
  ];
  return { subject: 'Reset your Valida Admin password', text: `${lines.join('\n\n')}\n\n${href}\n`, html: page('Reset your password', lines, { href, label: 'Choose a new password' }) };
}

const NOTICES = {
  PASSWORD_CHANGED: 'The password of your Valida Recruitment Admin account was changed.',
  PASSWORD_RESET_COMPLETED: 'The password of your Valida Recruitment Admin account was reset. All signed-in sessions were ended.',
  MFA_ENROLLED: 'Two-step verification was set up on your Valida Recruitment Admin account.',
  MFA_RECOVERY_CODE_USED: 'A recovery code was used to sign in to your Valida Recruitment Admin account.',
  MFA_RECOVERY_CODES_REGENERATED: 'New recovery codes were created for your Valida Recruitment Admin account. The previous codes no longer work.',
  MFA_RESET: 'Two-step verification was reset on your Valida Recruitment Admin account by an owner. You must set it up again at your next sign-in.',
  ADMIN_ACCOUNT_DISABLED: 'Your Valida Recruitment Admin account was disabled.',
  ADMIN_ACCOUNT_ENABLED: 'Your Valida Recruitment Admin account was enabled again.',
};

export function securityNoticeMessage({ notice }) {
  const lines = [NOTICES[notice] ?? 'A security-relevant change was made to your Valida Recruitment Admin account.', 'If this was not you, contact the Valida owner immediately.'];
  return { subject: 'Security notice — Valida Admin account', text: `${lines.join('\n\n')}\n`, html: page('Security notice', lines, null) };
}

import { API_BASE_URL } from '../../config/env.js';

/**
 * The Admin API client (E2; Doc 11 s180-184).
 *
 * - Cookie credentials only (`credentials: 'include'`); no token ever touches
 *   localStorage or sessionStorage (s183).
 * - The CSRF token lives in this module's memory (s184) and is sent as
 *   X-CSRF-Token on every state-changing request (s111). After a reload it is
 *   fetched again from /api/v1/auth/csrf.
 * - Errors keep the server's code, so screens branch on codes, never on bare
 *   status numbers.
 */

let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = typeof token === 'string' && token.length > 0 ? token : null;
}

export class AdminApiError extends Error {
  constructor({ status, code, message, fieldErrors = [], requestId = null }) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.requestId = requestId;
  }
}

const url = (path) => `${API_BASE_URL}/api/v1${path}`;

async function parse(response) {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function send(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    if (!csrfToken) await ensureCsrf();
    headers['X-CSRF-Token'] = csrfToken;
  }
  let response;
  try {
    response = await fetch(url(path), { method, headers, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new AdminApiError({ status: 0, code: 'NETWORK', message: 'Valida could not be reached. Check your connection and try again.' });
  }
  const payload = await parse(response);
  if (!response.ok || !payload || payload.success !== true) {
    const error = payload?.error ?? {};
    throw new AdminApiError({
      status: response.status,
      code: typeof error.code === 'string' ? error.code : 'UNEXPECTED',
      message: typeof error.message === 'string' ? error.message : 'Something went wrong. Try again.',
      fieldErrors: Array.isArray(error.fieldErrors) ? error.fieldErrors : [],
      requestId: payload?.meta?.requestId ?? null,
    });
  }
  // A response that rotates the token (login, MFA, activation, password change) carries the new one.
  if (typeof payload.data?.csrfToken === 'string') setCsrfToken(payload.data.csrfToken);
  return payload.data;
}

export async function ensureCsrf() {
  const response = await fetch(url('/auth/csrf'), { credentials: 'include', headers: { Accept: 'application/json' } }).catch(() => null);
  const payload = response ? await parse(response) : null;
  if (!response?.ok || !payload?.data?.csrfToken) {
    throw new AdminApiError({ status: response?.status ?? 0, code: 'NETWORK', message: 'Valida could not be reached. Check your connection and try again.' });
  }
  setCsrfToken(payload.data.csrfToken);
  return csrfToken;
}

export const adminApi = {
  get: (path) => send('GET', path),
  post: (path, body = {}) => send('POST', path, body),
  patch: (path, body = {}) => send('PATCH', path, body),
  del: (path) => send('DELETE', path),

  /** An authorised résumé download: bytes arrive only after the server's checks and audit (Doc 11 s166). */
  async download(path) {
    let response;
    try {
      response = await fetch(url(path), { credentials: 'include' });
    } catch {
      throw new AdminApiError({ status: 0, code: 'NETWORK', message: 'Valida could not be reached. Check your connection and try again.' });
    }
    if (!response.ok) {
      const payload = await parse(response);
      throw new AdminApiError({ status: response.status, code: payload?.error?.code ?? 'UNEXPECTED', message: payload?.error?.message ?? 'The file could not be downloaded.' });
    }
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
    const plain = /filename="([^"]+)"/.exec(disposition)?.[1];
    let filename = 'resume';
    try {
      filename = encoded ? decodeURIComponent(encoded) : plain ?? filename;
    } catch {
      filename = plain ?? filename;
    }
    return { blob: await response.blob(), filename };
  },
};

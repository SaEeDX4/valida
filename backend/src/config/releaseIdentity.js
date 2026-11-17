/**
 * C6-T5 — release identity (C6 plan r3 §8.4, reading 2; owner decision D-6).
 *
 * Both services — the API and the document server — state the commit they
 * run in one response header, so the deployed SHA can be read from outside
 * after every deploy and rebuild. The rule lives here once and is imported by
 * the document server (frontend/server/securityHeaders.js), as the site
 * access rule is.
 *
 *   Header           X-Valida-Release: <the full 40-character commit SHA>
 *   Source           RENDER_GIT_COMMIT, read from the PROCESS ENVIRONMENT
 *                    once, at start-up (the host sets it at build and run
 *                    time, plan §3.2). Never from a request: an incoming
 *                    X-Valida-Release header is ignored and overwritten on
 *                    every response, and absent configuration sends none.
 *
 * | Configuration                                    | Effect                                           |
 * | ------------------------------------------------ | ------------------------------------------------ |
 * | absent or empty (an ordinary local run)          | starts; no header; the start-up line says "unset" |
 * | exactly 40 lowercase hexadecimal characters      | starts; every response carries the header        |
 * | anything else (short, uppercase, spaces, a tag…) | REFUSED before listening; the value is not printed |
 *
 * A malformed value stops the service because a release header that is
 * wrong is worse than none: §8.4 compares it with the approved SHA. The value
 * is a public commit id (the repository is public), not a secret; it is
 * logged at start-up so the release check can also read it there.
 */
export const RELEASE_HEADER = 'X-Valida-Release';
export const RELEASE_SOURCE_VARIABLE = 'RENDER_GIT_COMMIT';
export const RELEASE_PROBLEM_TEXT = 'must be a full commit SHA: exactly 40 lowercase hexadecimal characters';

const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * @param {Record<string, string|undefined>} env the process environment
 * @returns {{ ok: true, sha: string|null, state: 'configured'|'unset' } | { ok: false, variable: string, rule: string }}
 */
export function resolveReleaseIdentity(env = {}) {
  const raw = env?.[RELEASE_SOURCE_VARIABLE];
  if (raw === undefined || raw === '') return Object.freeze({ ok: true, sha: null, state: 'unset' });
  if (typeof raw === 'string' && FULL_SHA.test(raw)) return Object.freeze({ ok: true, sha: raw, state: 'configured' });
  return Object.freeze({ ok: false, variable: RELEASE_SOURCE_VARIABLE, rule: RELEASE_PROBLEM_TEXT });
}

/** The start-up line's fields (no other configuration value). */
export function describeReleaseIdentity(release) {
  return { release: release?.sha ?? null, releaseState: release?.state ?? 'unset' };
}

/**
 * Sets (or removes) the header on a Node response, from configuration only.
 * Called first for every request, so redirects, refusals, errors and health
 * answers carry it too.
 */
export function stampRelease(res, release) {
  if (release?.sha) res.setHeader(RELEASE_HEADER, release.sha);
  else res.removeHeader(RELEASE_HEADER);
}

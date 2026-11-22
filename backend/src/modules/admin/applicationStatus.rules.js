/**
 * Application status lifecycle — Doc 12 sections 70-95 (E5).
 *
 * Real process variation, not a forced pipeline (s87): only the transitions
 * listed in s85 are normal. Terminal statuses (s84) move back only as an
 * exceptional correction by an ADMIN_OWNER with a written reason (s88-89, s92).
 */

export const ACTIVE_STATUSES = Object.freeze(['RECEIVED', 'IN_REVIEW', 'SCREENING', 'INTERVIEW', 'ASSESSMENT', 'FINAL_REVIEW', 'ON_HOLD']);
export const TERMINAL_STATUSES = Object.freeze(['SELECTED', 'NOT_SELECTED', 'WITHDRAWN']);

const ANY_ACTIVE_EXITS = ['ON_HOLD', 'NOT_SELECTED', 'WITHDRAWN'];

export const NORMAL_TRANSITIONS = Object.freeze({
  RECEIVED: ['IN_REVIEW', ...ANY_ACTIVE_EXITS],
  IN_REVIEW: ['SCREENING', 'INTERVIEW', 'ASSESSMENT', 'FINAL_REVIEW', ...ANY_ACTIVE_EXITS],
  SCREENING: ['INTERVIEW', 'ASSESSMENT', 'FINAL_REVIEW', ...ANY_ACTIVE_EXITS],
  INTERVIEW: ['ASSESSMENT', 'FINAL_REVIEW', ...ANY_ACTIVE_EXITS],
  ASSESSMENT: ['INTERVIEW', 'FINAL_REVIEW', ...ANY_ACTIVE_EXITS],
  FINAL_REVIEW: ['SELECTED', 'NOT_SELECTED', 'ON_HOLD', 'WITHDRAWN'],
  ON_HOLD: ['IN_REVIEW', 'SCREENING', 'INTERVIEW', 'ASSESSMENT', 'FINAL_REVIEW', 'NOT_SELECTED', 'WITHDRAWN'],
  SELECTED: [],
  NOT_SELECTED: [],
  WITHDRAWN: [],
});

/** s88 — a terminal Application may be reopened to an active stage, as a correction. */
export const CORRECTION_TARGETS = Object.freeze(['IN_REVIEW', 'SCREENING', 'INTERVIEW', 'ASSESSMENT', 'FINAL_REVIEW', 'ON_HOLD']);

/**
 * @returns {{ allowed: true, correction: boolean } | { allowed: false, code: string, message: string }}
 */
export function checkTransition({ from, to, roles = [], reason = null }) {
  if (from === to) return { allowed: false, code: 'STATUS_UNCHANGED', message: 'The Application already has this status.' };
  if ((NORMAL_TRANSITIONS[from] ?? []).includes(to)) return { allowed: true, correction: false };
  if (TERMINAL_STATUSES.includes(from) && CORRECTION_TARGETS.includes(to)) {
    if (!roles.includes('ADMIN_OWNER')) {
      return { allowed: false, code: 'CORRECTION_REQUIRES_OWNER', message: 'Only an owner can reopen a decided Application.' };
    }
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      return { allowed: false, code: 'REASON_REQUIRED', message: 'Explain why this decided Application is being reopened.' };
    }
    return { allowed: true, correction: true };
  }
  return { allowed: false, code: 'TRANSITION_NOT_ALLOWED', message: `An Application cannot move from ${from} to ${to}.` };
}

/** The next statuses an Admin with `roles` may choose from `from`. */
export function allowedNextStatuses(from, roles = []) {
  const normal = NORMAL_TRANSITIONS[from] ?? [];
  const corrections = TERMINAL_STATUSES.includes(from) && roles.includes('ADMIN_OWNER') ? CORRECTION_TARGETS : [];
  return [...normal, ...corrections].map((status) => ({ status, correction: corrections.includes(status) && !normal.includes(status) }));
}

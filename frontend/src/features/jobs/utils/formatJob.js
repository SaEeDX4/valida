/**
 * Presentation helpers for public Job DTO values.
 *
 * Every helper returns null when the underlying value is absent. Nothing here
 * invents a default, a placeholder or a "not specified" string — a field the
 * API did not send is simply not rendered (Doc 06 section 99).
 */

/** Turns an API enum such as FULLY_REMOTE into "Fully remote". */
export function formatEnumLabel(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const words = value.trim().split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return null;
  const [first, ...rest] = words;
  return [first.charAt(0) + first.slice(1).toLowerCase(), ...rest.map((w) => w.toLowerCase())]
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());
}

/** "30 hours per week", or null when weeklyHours is absent (Doc 06 section 98). */
export function formatWeeklyHours(weeklyHours) {
  return typeof weeklyHours === 'number' && Number.isFinite(weeklyHours)
    ? `${weeklyHours} hours per week`
    : null;
}

/**
 * "CAD 35.00 gross per hour" (Doc 06 section 98).
 * Returns null unless currency and a finite amount are both present.
 */
export function formatCompensation(compensation) {
  if (!compensation || typeof compensation !== 'object') return null;
  const { currency, amount, unit, gross } = compensation;
  if (typeof currency !== 'string' || typeof amount !== 'number' || !Number.isFinite(amount)) {
    return null;
  }
  const money = `${currency} ${amount.toFixed(2)}`;
  const period = unit === 'HOUR' ? 'per hour' : unit ? `per ${String(unit).toLowerCase()}` : null;
  return [money, gross ? 'gross' : null, period].filter(Boolean).join(' ');
}

/**
 * Builds the Job Detail fact rows, omitting every absent value.
 * Labels are canonical (Doc 06 section 97).
 */
export function buildJobFacts(job) {
  if (!job || typeof job !== 'object') return [];
  return [
    { label: 'Location', value: typeof job.location === 'string' ? job.location : null },
    { label: 'Work Arrangement', value: formatEnumLabel(job.workArrangement) },
    { label: 'Employment Type', value: formatEnumLabel(job.employmentType) },
    { label: 'Schedule', value: typeof job.schedule === 'string' ? job.schedule : null },
    { label: 'Weekly Hours', value: formatWeeklyHours(job.weeklyHours) },
    { label: 'Compensation', value: formatCompensation(job.compensation) },
  ].filter((fact) => Boolean(fact.value));
}

/** A Job accepts applications only when the API says so (Doc 09 section 44). */
export function isJobOpen(job) {
  return Boolean(job) && job.applicationStatus === 'OPEN';
}

/** A retained, previously public Job that no longer accepts applications. */
export function isJobClosed(job) {
  return Boolean(job) && job.applicationStatus === 'CLOSED';
}

/** Non-empty string arrays only; anything else renders nothing. */
export function toContentList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

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
 * "CAD 35.00 gross per hour" (Doc 06 section 98). No designation when the Job
 * states neither gross nor net.
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
  return [money, gross === true ? 'gross' : gross === false ? 'net' : null, period].filter(Boolean).join(' ');
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

/*
 * C4 — the Job's dates (owner decision OD-2026-11-07-01: the labels
 * "Date Posted" and "Applications Close").
 *
 * The API sends publishedAt and closesAt as ISO 8601 instants in UTC
 * (Date#toISOString). They are shown in UTC — the server's time, which decides
 * whether a Job is open (Doc 12 section 15) — never in the visitor's own zone:
 * a deadline then reads the same on every device and in the structured data,
 * and cannot shift by a day with the reader's location. The closing time is
 * labelled "UTC"; the posting date needs no time.
 *
 * Only a well-formed instant WITH an explicit zone is accepted: a zoneless
 * value would be read in the reader's local time, which is exactly the
 * ambiguity being avoided. Anything else returns null and is not shown.
 */
const MONTHS = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);
const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/;

/**
 * A Date for an ISO 8601 instant with an explicit zone, or null.
 * Each field is range-checked: Date.parse would silently roll an impossible
 * date such as 30 February over into March.
 */
export function parseJobInstant(value) {
  const match = typeof value === 'string' ? INSTANT_PATTERN.exec(value) : null;
  if (!match) return null;
  const [, y, mo, d, h, mi, sec = '0', zone, zh = '0', zm = '0'] = match;
  const [year, month, day] = [Number(y), Number(mo), Number(d)];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(sec) > 59) return null;
  if (zone !== 'Z' && (Number(zh) > 23 || Number(zm) > 59)) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

const two = (n) => String(n).padStart(2, '0');

/** "1 November 2026" — the instant's UTC calendar date — or null. */
export function formatJobDate(value) {
  const date = parseJobInstant(value);
  return date ? `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}` : null;
}

/** "31 March 2027, 23:59 UTC" — the instant in UTC, to the minute — or null. */
export function formatJobDeadline(value) {
  const date = parseJobInstant(value);
  return date ? `${formatJobDate(value)}, ${two(date.getUTCHours())}:${two(date.getUTCMinutes())} UTC` : null;
}

/**
 * The date rows of an OPEN Job's "Employment Details" (the same predicates
 * decide datePosted / validThrough in src/seo/jobPosting.js):
 *   Date Posted         from publishedAt;
 *   Applications Close  only for a valid closesAt — no closing date, no row.
 * `dateTime` is the instant as the API sent it, for a <time> element.
 */
export function buildJobDateFacts(job, labels) {
  if (!job || typeof job !== 'object') return [];
  return [
    { label: labels.datePosted, value: formatJobDate(job.publishedAt), dateTime: job.publishedAt },
    { label: labels.applicationsClose, value: formatJobDeadline(job.closesAt), dateTime: job.closesAt },
  ].filter((fact) => Boolean(fact.value));
}

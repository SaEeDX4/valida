import { ABOUT_META } from '../pages/AboutPage.content.js';
import { CAREERS_META } from '../pages/CareersPage.content.js';
import { HOME_META } from '../pages/HomePage.content.js';
import { LEGAL_META } from '../pages/LegalPage.content.js';
import { PRIVACY_META } from '../pages/PrivacyPage.content.js';
import { jobDetailDescription, jobDetailTitle } from '../pages/JobDetailPage.content.js';
import { applyTitle } from '../pages/ApplyPage.content.js';
import { isJobClosed, isJobOpen } from '../features/jobs/utils/formatJob.js';
import { ROUTES, jobRoute } from '../routes/paths.js';
import { ROBOTS } from './head.js';

/**
 * What each public route — in each of its states — says about itself in the
 * <head> (C4). The pages render these through PageMeta; the document server
 * renders the same objects into the initial HTML. One table, so the two can
 * only agree.
 *
 * Every title and description is the Document 06 copy already used since
 * A4/A5 (the *.content.js modules); nothing new is written here.
 *
 * Title patterns: Document 06 (sections 11, 54, 77, 94, 109, 155, 170, 179) and
 * Document 16 section 85 give different title patterns. The accepted A6/C2
 * titles follow Document 06 — the baselined content authority — and are kept;
 * the difference is raised as a Doc 00 conflict in the C4 handoff, not
 * resolved silently here.
 */

/** The five indexable static routes (Doc 16 section 78). */
export const STATIC_HEADS = Object.freeze({
  HOME: Object.freeze({ ...HOME_META, path: ROUTES.HOME }),
  ABOUT: Object.freeze({ ...ABOUT_META, path: ROUTES.ABOUT }),
  CAREERS: Object.freeze({ ...CAREERS_META, path: ROUTES.CAREERS }),
  PRIVACY: Object.freeze({ ...PRIVACY_META, path: ROUTES.PRIVACY }),
  LEGAL: Object.freeze({ ...LEGAL_META, path: ROUTES.LEGAL }),
});

export const STATIC_HEAD_BY_PATH = Object.freeze({
  [ROUTES.HOME]: STATIC_HEADS.HOME,
  [ROUTES.ABOUT]: STATIC_HEADS.ABOUT,
  [ROUTES.CAREERS]: STATIC_HEADS.CAREERS,
  [ROUTES.PRIVACY]: STATIC_HEADS.PRIVACY,
  [ROUTES.LEGAL]: STATIC_HEADS.LEGAL,
});

/** Unknown route, and an unknown / Draft / Archived Job (Doc 16 sections 115-120). */
export const NOT_FOUND_HEAD = Object.freeze({ title: 'Page Not Found | Valida', robots: ROBOTS.NOINDEX_FOLLOW });

/** Job Detail while the Job loads (client only; unchanged from C2). */
export const JOB_LOADING_HEAD = Object.freeze({ title: 'Careers at Valida' });

/** Job Detail when the Jobs API failed or answered malformed data — not a 404 (Doc 16 section 259). */
export const JOB_ERROR_HEAD = Object.freeze({ title: 'Careers at Valida', robots: ROBOTS.NOINDEX_FOLLOW });

/**
 * Job Detail for a public Job.
 *   OPEN    indexable, self-canonical; JobPosting when its inputs exist
 *           (Doc 16 sections 124-136; withheld today, see src/seo/jobPosting.js).
 *   CLOSED  visible at its stable URL, "noindex, follow", no JobPosting
 *           (sections 121-123, 140).
 */
export function jobDetailHead(job) {
  const base = {
    title: jobDetailTitle(job.title),
    description: jobDetailDescription(job.title),
    path: jobRoute(job.slug),
  };
  if (isJobOpen(job)) return { ...base, jobPosting: job };
  if (isJobClosed(job)) return { ...base, robots: ROBOTS.NOINDEX_FOLLOW };
  return { ...base, robots: ROBOTS.NOINDEX_FOLLOW };
}

/** Apply: always "noindex, follow" (Doc 16 section 79, SEO-017) and never JobPosting (section 125). */
export const APPLY_PENDING_HEAD = Object.freeze({ title: 'Apply | Valida', robots: ROBOTS.NOINDEX_FOLLOW });

export function applyHead(job) {
  return { title: applyTitle(job.title), robots: ROBOTS.NOINDEX_FOLLOW };
}

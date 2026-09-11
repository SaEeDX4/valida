import { ROUTES } from '../../../routes/paths.js';

/**
 * Phase 1 primary navigation.
 *
 * Doc 04 section 7 defines primary navigation as Home, About and Careers, and
 * makes the literal Home link optional on desktop when logo behaviour is clear.
 * The A3 authorization enumerates all three, so all three are rendered; the
 * logo additionally returns Home per Doc 05 section 10.
 *
 * Doc 04 section 8 forbids adding Job Detail, Apply, Privacy, Legal, Services,
 * Cybersecurity or Contact here. Privacy and Legal live in the footer as
 * secondary navigation (Doc 04 section 9).
 *
 * Labels are the canonical strings from Document 06 section 8.
 */
export const PRIMARY_NAV = [
  // `end` so Home is active only at exactly "/", not on every nested route.
  { to: ROUTES.HOME, label: 'Home', end: true },
  { to: ROUTES.ABOUT, label: 'About', end: false },
  // Careers stays active across /careers/:jobSlug and .../apply.
  { to: ROUTES.CAREERS, label: 'Careers', end: false },
];

/**
 * Header CTA.
 *
 * Doc 05 section 12 and Doc 06 section 8: "Explore Careers" is the Phase 1
 * wording. "View Open Roles" is reserved for an actively recruiting context,
 * and no published role exists until Milestone B3 — so using it now would
 * imply open roles that do not exist. Doc 05 section 12 explicitly forbids a
 * misleading global CTA.
 */
export const HEADER_CTA = { to: ROUTES.CAREERS, label: 'Explore Careers' };

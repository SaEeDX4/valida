import { BrowserRouter, Route, Routes } from 'react-router';
import PublicLayout from '../layouts/PublicLayout.jsx';
import ApplyLayout from '../layouts/ApplyLayout.jsx';
import RouteChangeHandler from './RouteChangeHandler.jsx';
import HomePage from '../pages/HomePage.jsx';
import AboutPage from '../pages/AboutPage.jsx';
import CareersPage from '../pages/CareersPage.jsx';
import JobDetailPage from '../pages/JobDetailPage.jsx';
import ApplyPage from '../pages/ApplyPage.jsx';
import PrivacyPage from '../pages/PrivacyPage.jsx';
import LegalPage from '../pages/LegalPage.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';
import { ROUTES } from './paths.js';

/**
 * Application routes — Doc 08 sections 15-16, Doc 04 section 6.
 *
 * Two shells, matching the Doc 08 route hierarchy:
 *
 *   PublicLayout — Home, About, Careers, Job Detail, Privacy, Legal, 404
 *   ApplyLayout  — Apply only
 *
 * Apply gets its own simplified shell (Doc 08 section 23) so a candidate
 * completing an application is not offered the marketing navigation. Every
 * other route shares PublicLayout, so that shell is still defined once.
 *
 * The catch-all renders NotFoundPage inside PublicLayout, which is what makes
 * an unknown URL a branded, navigable experience rather than a blank screen
 * (Doc 04 section 43). React Router ranks routes by specificity, so
 * /careers/:jobSlug/apply resolves to the ApplyLayout route and never falls
 * through to the catch-all.
 *
 * BrowserRouter is used rather than a hash router so the canonical URL style
 * in Doc 04 section 47 is real. Doc 04 sections 44-45 require direct entry and
 * refresh to resolve correctly; in development Vite already serves the SPA
 * fallback, and production hosting fallback is finalised in Release C
 * (Doc 18 section 58).
 *
 * Routes are NOT lazy-loaded. A6 measured the real production build against
 * the Doc 16 budgets: the whole application is 105.4 KiB of compressed JS
 * against a PERF-009 budget of 220 KiB. Splitting it would add suspense
 * boundaries and a loading state to every route transition for a saving that
 * no budget requires, so A6 deliberately kept a single bundle. Revisit if
 * `npm run verify:budgets` approaches the limit.
 *
 * `basename` is intentionally omitted: the site is served from the domain
 * root, which is the canonical URL style.
 */
export function AppRoutes() {
  return (
    <>
      {/*
        ONE route-change handler for the whole application, mounted above both
        layouts rather than inside each.

        The handler skips its first render so it never steals focus on initial
        page load. When it lived inside each layout, navigating between layouts
        (Job Detail -> Apply, Apply -> Careers) unmounted one instance and
        mounted a fresh one — which treated the navigation as a first render and
        did nothing. The clicked link then unmounted with the old layout and
        focus fell to <body>. A single instance keeps its first-render guard
        across layout switches, so every navigation is handled the same way.
      */}
      <RouteChangeHandler />
      <Routes>
      <Route element={<PublicLayout />}>
        <Route path={ROUTES.HOME} element={<HomePage />} />
        <Route path={ROUTES.ABOUT} element={<AboutPage />} />
        <Route path={ROUTES.CAREERS} element={<CareersPage />} />
        <Route path={ROUTES.JOB_DETAIL} element={<JobDetailPage />} />
        <Route path={ROUTES.PRIVACY} element={<PrivacyPage />} />
        <Route path={ROUTES.LEGAL} element={<LegalPage />} />
        <Route path={ROUTES.NOT_FOUND} element={<NotFoundPage />} />
      </Route>

      <Route element={<ApplyLayout />}>
        <Route path={ROUTES.APPLY} element={<ApplyPage />} />
      </Route>
      </Routes>
    </>
  );
}

/**
 * Router host. Separated from AppRoutes so tests can mount the same route
 * table inside a MemoryRouter at any starting URL.
 */
export default function AppRouter() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

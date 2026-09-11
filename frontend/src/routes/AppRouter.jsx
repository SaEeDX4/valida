import { BrowserRouter, Route, Routes } from 'react-router';
import PublicLayout from '../layouts/PublicLayout.jsx';
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
 * Every Phase 1 route nests under PublicLayout, so the shell is defined once
 * and each route renders through the Outlet. The catch-all renders
 * NotFoundPage inside the same shell, which is what makes an unknown URL a
 * branded, navigable experience rather than a blank screen (Doc 04 section 43).
 *
 * BrowserRouter is used rather than a hash router so the canonical URL style
 * in Doc 04 section 47 is real. Doc 04 sections 44-45 require direct entry and
 * refresh to resolve correctly; in development Vite already serves the SPA
 * fallback, and production hosting fallback is finalised in Release C
 * (Doc 18 section 58).
 *
 * Routes are NOT lazy-loaded in A3. Doc 18 section 57 says "as appropriate",
 * and every page is currently a placeholder of a few lines; code-splitting
 * them would add suspense boundaries and loading states around content that
 * does not exist yet. Lazy loading is revisited in A6 alongside the real
 * performance budget.
 *
 * `basename` is intentionally omitted: the site is served from the domain
 * root, which is the canonical URL style.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path={ROUTES.HOME} element={<HomePage />} />
        <Route path={ROUTES.ABOUT} element={<AboutPage />} />
        <Route path={ROUTES.CAREERS} element={<CareersPage />} />
        <Route path={ROUTES.JOB_DETAIL} element={<JobDetailPage />} />
        <Route path={ROUTES.APPLY} element={<ApplyPage />} />
        <Route path={ROUTES.PRIVACY} element={<PrivacyPage />} />
        <Route path={ROUTES.LEGAL} element={<LegalPage />} />
        <Route path={ROUTES.NOT_FOUND} element={<NotFoundPage />} />
      </Route>
    </Routes>
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
